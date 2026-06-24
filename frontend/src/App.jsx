import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  Server,
  Terminal,
  User
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

function App() {
  // Authentication State
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('deploy_engine_token') || '');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Input fields for deployment
  const [image, setImage] = useState('');
  const [tag, setTag] = useState('latest');
  const [containerNameInput, setContainerNameInput] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);

  // Floating Toast Notifications state
  const [toasts, setToasts] = useState([]);

  // Toast utility helper
  const showToast = (title, message, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Deployments tab state (initialized from localStorage to persist on refresh)
  const [deployments, setDeployments] = useState(() => {
    try {
      const saved = localStorage.getItem('deploy_engine_deployments');
      if (saved) {
        // Parse dates back to Date objects
        const parsed = JSON.parse(saved);
        return parsed.map(d => ({ ...d, time: new Date(d.time) }));
      }
    } catch (e) {
      console.error('Failed to load deployments from localStorage', e);
    }
    return [];
  });
  const [expandedDeployments, setExpandedDeployments] = useState(new Set());

  // Navigation tab
  const [activeTab, setActiveTab] = useState('deployments'); // 'deployments' | 'containers'

  // Containers tab state
  const [containers, setContainers] = useState([]);
  const [containerSearch, setContainerSearch] = useState('');
  const [selectedContainerId, setSelectedContainerId] = useState(null);
  const [logs, setLogs] = useState('');
  const [isFetchingContainers, setIsFetchingContainers] = useState(false);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [isLogsAutoRefresh, setIsLogsAutoRefresh] = useState(false);

  // Button actions loading state
  const [actionLoading, setActionLoading] = useState({
    start: false,
    stop: false,
    delete: false,
    refresh: false,
    copy: false
  });

  const logsConsoleRef = useRef(null);
  const autoRefreshIntervalRef = useRef(null);

  // Preset quick picks
  const imagePresets = ['nginx', 'node', 'postgres', 'redis', 'python'];
  const tagPresets = ['latest', 'alpine', 'slim', 'stable'];

  // Persist deployments to localStorage when they change
  useEffect(() => {
    localStorage.setItem('deploy_engine_deployments', JSON.stringify(deployments));
  }, [deployments]);

  // Handle auto-refresh interval for container status and logs
  useEffect(() => {
    if (authToken && activeTab === 'containers' && isLogsAutoRefresh) {
      autoRefreshIntervalRef.current = setInterval(() => {
        if (selectedContainerId) {
          fetchLogsQuietly(selectedContainerId);
        }
        fetchContainersQuietly();
      }, 3000);
    } else {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
        autoRefreshIntervalRef.current = null;
      }
    }

    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
    };
  }, [authToken, activeTab, isLogsAutoRefresh, selectedContainerId]);

  // Fetch containers list once when tab changes to containers
  useEffect(() => {
    if (authToken && activeTab === 'containers') {
      fetchContainers();
    }
  }, [authToken, activeTab]);

  // Auto-scroll logs console to bottom when logs update
  useEffect(() => {
    if (logsConsoleRef.current) {
      logsConsoleRef.current.scrollTop = logsConsoleRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle Logout
  const handleLogout = (message = '') => {
    setAuthToken('');
    localStorage.removeItem('deploy_engine_token');
    setLoginUsername('');
    setLoginPassword('');
    setLoginError('');
    setSelectedContainerId(null);
    setLogs('');
    setContainers([]);
    if (message) {
      showToast('Logged Out', message, 'info');
    }
  };

  // Submit Login
  const handleLoginSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError('Username and password are required.');
      return;
    }
    setIsLoggingIn(true);
    setLoginError('');

    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Login failed.');
      }

      const token = json.data.token;
      localStorage.setItem('deploy_engine_token', token);
      setAuthToken(token);
      showToast('Welcome', 'Logged in successfully', 'success');
    } catch (err) {
      setLoginError(err.message || 'Invalid username or password.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Helper function to check 401 response and redirect
  const checkAuthResponse = (res) => {
    if (res.status === 401) {
      handleLogout('Session expired. Please log in again.');
      return true;
    }
    return false;
  };

  // Validation for Deployments
  const validateForm = () => {
    if (!image.trim()) {
      setValidationError('Image name is required.');
      return false;
    }
    if (!/^[a-z0-9._\-\/:]+$/i.test(image.trim())) {
      setValidationError('Image name contains invalid characters.');
      return false;
    }
    if (!tag.trim()) {
      setValidationError('Tag is required.');
      return false;
    }
    if (containerNameInput.trim() && !/^[a-z0-9-]{3,63}$/.test(containerNameInput.trim())) {
      setValidationError('Container name must be 3-63 characters, containing only lowercase alphanumeric and hyphens.');
      return false;
    }
    setValidationError('');
    return true;
  };

  // Deploy container
  const handleDeploy = async (e) => {
    if (e) e.preventDefault();
    if (!validateForm()) return;

    const newDeployment = {
      id: Date.now(),
      image: image.trim(),
      tag: tag.trim() || 'latest',
      time: new Date(),
      status: 'pending',
      data: null,
      error: null
    };

    setDeployments((prev) => [newDeployment, ...prev]);
    setExpandedDeployments((prev) => {
      const next = new Set(prev);
      next.add(newDeployment.id);
      return next;
    });
    setIsDeploying(true);
    showToast('Deploying', `Pulling image and starting container...`, 'info');

    try {
      const res = await fetch('/container', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          image: newDeployment.image,
          tag: newDeployment.tag,
          name: containerNameInput.trim() || undefined
        })
      });

      if (checkAuthResponse(res)) return;

      const json = await res.json();

      if (!res.ok || json.status !== 'success') {
        throw new Error(json.message || json.error || `Server responded with status ${res.status}`);
      }

      setDeployments((prev) =>
        prev.map((d) =>
          d.id === newDeployment.id
            ? { ...d, status: 'success', data: json.data }
            : d
        )
      );
      setContainerNameInput('');
      showToast('Deployed', `Container deployed successfully.`, 'success');
    } catch (err) {
      setDeployments((prev) =>
        prev.map((d) =>
          d.id === newDeployment.id
            ? { ...d, status: 'error', error: err.message || 'Unknown error occurred.' }
            : d
        )
      );
      showToast('Deployment Failed', err.message, 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  // Fetch all containers (with loading spinner)
  const fetchContainers = async () => {
    setIsFetchingContainers(true);
    try {
      const res = await fetch('/containers', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkAuthResponse(res)) return;

      const json = await res.json();
      if (res.ok && json.status === 'success') {
        setContainers(json.data);
      } else {
        console.error(json.message || 'Failed to fetch containers');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingContainers(false);
    }
  };

  // Quietly update containers list (for auto-refresh)
  const fetchContainersQuietly = async () => {
    try {
      const res = await fetch('/containers', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkAuthResponse(res)) return;

      const json = await res.json();
      if (res.ok && json.status === 'success') {
        setContainers(json.data);
      }
    } catch (err) {
      // ignore
    }
  };

  // Fetch container logs (with loading state)
  const fetchLogs = async (id) => {
    setIsFetchingLogs(true);
    try {
      const res = await fetch(`/containers/${id}/logs?tail=300`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkAuthResponse(res)) return;

      const json = await res.json();
      if (res.ok && json.status === 'success') {
        setLogs(json.data.logs || '');
      } else {
        setLogs(`Error: ${json.message || 'Failed to fetch logs'}`);
      }
    } catch (err) {
      setLogs(`Error: ${err.message}`);
    } finally {
      setIsFetchingLogs(false);
    }
  };

  // Quietly update container logs (for auto-refresh)
  const fetchLogsQuietly = async (id) => {
    try {
      const res = await fetch(`/containers/${id}/logs?tail=300`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkAuthResponse(res)) return;

      const json = await res.json();
      if (res.ok && json.status === 'success') {
        setLogs(json.data.logs || '');
      }
    } catch (err) {
      // ignore
    }
  };

  // Select container to view logs and perform actions
  const selectContainer = (id) => {
    setSelectedContainerId(id);
    fetchLogs(id);
  };

  // Start selected container
  const startSelectedContainer = async () => {
    if (!selectedContainerId) return;
    setActionLoading((prev) => ({ ...prev, start: true }));
    try {
      const res = await fetch(`/containers/${selectedContainerId}/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkAuthResponse(res)) return;

      const json = await res.json();
      if (!res.ok || json.status !== 'success') {
        throw new Error(json.message || 'Failed to start container');
      }
      showToast('Started', 'Container started successfully', 'success');
      await fetchContainersQuietly();
    } catch (err) {
      showToast('Error', err.message, 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, start: false }));
    }
  };

  // Stop selected container
  const stopSelectedContainer = async () => {
    if (!selectedContainerId) return;
    setActionLoading((prev) => ({ ...prev, stop: true }));
    try {
      const res = await fetch(`/containers/${selectedContainerId}/stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkAuthResponse(res)) return;

      const json = await res.json();
      if (!res.ok || json.status !== 'success') {
        throw new Error(json.message || 'Failed to stop container');
      }
      showToast('Stopped', 'Container stopped successfully', 'success');
      await fetchContainersQuietly();
    } catch (err) {
      showToast('Error', err.message, 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, stop: false }));
    }
  };

  // Delete selected container
  const deleteSelectedContainer = async () => {
    if (!selectedContainerId) return;
    const selected = containers.find((c) => c.id === selectedContainerId);
    const containerName = selected ? selected.name : 'this container';

    if (!window.confirm(`Are you sure you want to delete container "${containerName}"?`)) {
      return;
    }

    setActionLoading((prev) => ({ ...prev, delete: true }));
    try {
      const res = await fetch(`/containers/${selectedContainerId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkAuthResponse(res)) return;

      const json = await res.json();
      if (!res.ok || json.status !== 'success') {
        throw new Error(json.message || 'Failed to delete container');
      }
      showToast('Deleted', `Container "${containerName}" deleted successfully`, 'success');
      setSelectedContainerId(null);
      setLogs('');
      await fetchContainers();
    } catch (err) {
      showToast('Error', err.message, 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, delete: false }));
    }
  };

  // Copy logs console output to clipboard
  const copyLogsText = () => {
    if (!logs) return;
    setActionLoading((prev) => ({ ...prev, copy: true }));
    navigator.clipboard.writeText(logs)
      .then(() => {
        showToast('Copied', 'Logs copied to clipboard', 'success');
        setTimeout(() => {
          setActionLoading((prev) => ({ ...prev, copy: false }));
        }, 1500);
      })
      .catch((err) => {
        showToast('Copy Failed', 'Failed to copy logs: ' + err, 'error');
        setActionLoading((prev) => ({ ...prev, copy: false }));
      });
  };

  // Explicit refresh of logs
  const refreshSelectedLogs = async () => {
    if (!selectedContainerId) return;
    setActionLoading((prev) => ({ ...prev, refresh: true }));
    await fetchLogs(selectedContainerId);
    setActionLoading((prev) => ({ ...prev, refresh: false }));
  };

  // Format time (HH:MM:SS)
  const formatTime = (dateObj) => {
    return dateObj.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Collapsible logs toggle
  const toggleDeploymentLogs = (id) => {
    setExpandedDeployments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Change tab selection
  const switchTab = (tab) => {
    setActiveTab(tab);
    if (tab !== 'containers') {
      setIsLogsAutoRefresh(false);
    }
  };

  // Clear local deployments list
  const clearDeploymentsList = () => {
    setDeployments([]);
    setExpandedDeployments(new Set());
  };

  // Input keypress submit
  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleDeploy();
    }
  };

  // Filtered container items based on query
  const filteredContainers = containers.filter((c) => {
    const q = containerSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.image.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.state.toLowerCase().includes(q)
    );
  });

  const selectedContainer = containers.find((c) => c.id === selectedContainerId);
  const isSelectedRunning = selectedContainer && selectedContainer.state === 'running';

  // Format container ports
  const formatPorts = (ports) => {
    if (!ports || ports.length === 0) return 'N/A';
    return ports
      .map((p) => (p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : `${p.PrivatePort}`))
      .join(', ');
  };

  return (
    <>
      {!authToken ? (
        <div className="login-wrapper">
          <div className="login-card">
            <div className="login-header-logo">
              <svg width="28" height="28" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="1" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.9" />
                <rect x="10" y="1" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.4" />
                <rect x="1" y="10" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.4" />
                <rect x="10" y="10" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.7" />
              </svg>
              <h2>deploy-engine</h2>
              <p>Access the management console</p>
            </div>

            <form onSubmit={handleLoginSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="loginUser">Username</label>
                <div className="login-input-icon-wrap">
                  <User size={13} className="icon" />
                  <input
                    id="loginUser"
                    type="text"
                    placeholder="Enter username"
                    value={loginUsername}
                    onChange={(e) => {
                      setLoginUsername(e.target.value);
                      setLoginError('');
                    }}
                    autoComplete="username"
                    spellCheck="false"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="loginPass">Password</label>
                <div className="login-input-icon-wrap">
                  <Lock size={13} className="icon" />
                  <input
                    id="loginPass"
                    type="password"
                    placeholder="Enter password"
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      setLoginError('');
                    }}
                    autoComplete="current-password"
                    required
                    style={{
                      width: '100%',
                      background: 'var(--surface)',
                      border: '1px solid var(--border-hi)',
                      borderRadius: '6px',
                      color: 'var(--text)',
                      fontFamily: 'var(--mono)',
                      fontSize: '13px',
                      padding: '10px 12px 10px 38px',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              {loginError && (
                <div className="validation-msg visible" style={{ display: 'flex', marginTop: '0' }}>
                  <AlertTriangle size={13} style={{ color: 'var(--error)', flexShrink: 0 }} />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                className={`login-btn ${isLoggingIn ? 'loading' : ''}`}
                disabled={isLoggingIn}
              >
                <div className="spinner"></div>
                <span>Sign In</span>
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="shell">
      {/* TOPBAR */}
      <header className="topbar">
        <div className="topbar-logo">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="1" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.9" />
            <rect x="10" y="1" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.4" />
            <rect x="1" y="10" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.4" />
            <rect x="10" y="10" width="7" height="7" rx="1.5" fill="#00e5a0" opacity="0.7" />
          </svg>
          deploy-engine
        </div>
        <div className="topbar-divider">
          <div className="status-dot"></div>
          <span className="engine-label">DOCKER DAEMON CONNECTED</span>
          <button className="btn-logout" onClick={handleLogout} title="Sign out of console">
            <LogOut size={12} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      <div className="main">
        {/* LEFT PANEL */}
        <aside className="panel">
          <div className="panel-header">
            <h1>New Deployment</h1>
            <p>Pull an image and launch a container. It will be attached to the proxy network automatically.</p>
          </div>

          <form onSubmit={handleDeploy} style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            {/* IMAGE */}
            <div className="form-group">
              <label htmlFor="imageInput">Image</label>
              <div className="input-wrap">
                <input
                  id="imageInput"
                  type="text"
                  placeholder="nginx"
                  autoComplete="off"
                  spellCheck="false"
                  value={image}
                  onChange={(e) => {
                    setImage(e.target.value);
                    setValidationError('');
                  }}
                  onKeyDown={handleInputKeyDown}
                  className={validationError.toLowerCase().includes('image') ? 'error-field' : ''}
                />
              </div>
              <div className="field-hint">Registry path or Docker Hub name</div>
              <div className="preset-section-label" style={{ marginTop: '8px' }}>Quick pick</div>
              <div className="preset-row">
                {imagePresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`preset-tag ${image === preset ? 'active' : ''}`}
                    onClick={() => {
                      setImage(preset);
                      setValidationError('');
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* TAG */}
            <div className="form-group">
              <label htmlFor="tagInput">Tag</label>
              <div className="input-wrap">
                <span className="prefix">:</span>
                <input
                  id="tagInput"
                  type="text"
                  className={`has-prefix ${validationError.toLowerCase().includes('tag') ? 'error-field' : ''}`}
                  placeholder="latest"
                  autoComplete="off"
                  spellCheck="false"
                  value={tag}
                  onChange={(e) => {
                    setTag(e.target.value);
                    setValidationError('');
                  }}
                  onKeyDown={handleInputKeyDown}
                />
              </div>
              <div className="preset-row" style={{ marginTop: '6px' }}>
                {tagPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`preset-tag ${tag === preset ? 'active' : ''}`}
                    onClick={() => {
                      setTag(preset);
                      setValidationError('');
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* CONTAINER NAME */}
            <div className="form-group">
              <label htmlFor="nameInput">Container Name (Optional)</label>
              <div className="input-wrap">
                <input
                  id="nameInput"
                  type="text"
                  placeholder="e.g., custom-app-name"
                  autoComplete="off"
                  spellCheck="false"
                  value={containerNameInput}
                  onChange={(e) => {
                    setContainerNameInput(e.target.value);
                    setValidationError('');
                  }}
                  onKeyDown={handleInputKeyDown}
                  className={validationError.toLowerCase().includes('container name') ? 'error-field' : ''}
                />
              </div>
              <div className="field-hint">Only lowercase letters, numbers, and hyphens (3-63 chars)</div>
            </div>

            {/* VALIDATION */}
            {validationError && (
              <div className="validation-msg visible">
                <AlertTriangle size={13} style={{ color: 'var(--error)' }} />
                <span>{validationError}</span>
              </div>
            )}

            {/* SUBMIT */}
            <button
              type="submit"
              className={`btn-deploy ${isDeploying ? 'loading' : ''}`}
              disabled={isDeploying}
            >
              <div className="spinner"></div>
              <span className="btn-text">Deploy Container</span>
            </button>
          </form>
        </aside>

        {/* OUTPUT PANE */}
        <section className="output-pane">
          <div className="output-toolbar">
            <div
              className={`output-tab ${activeTab === 'deployments' ? 'active' : ''}`}
              onClick={() => switchTab('deployments')}
            >
              Deployments
            </div>
            <div
              className={`output-tab ${activeTab === 'containers' ? 'active' : ''}`}
              onClick={() => switchTab('containers')}
            >
              Containers
            </div>
            {activeTab === 'deployments' && (
              <div className="output-actions">
                <button className="btn-sm" onClick={clearDeploymentsList}>Clear</button>
              </div>
            )}
          </div>

          {/* TAB 1: DEPLOYMENTS VIEW */}
          {activeTab === 'deployments' && (
            <div className="output-body">
              {deployments.length === 0 ? (
                <div className="empty-state">
                  <Server className="empty-icon" size={44} />
                  <h3>No deployments yet</h3>
                  <p>Fill in the image and tag, then click Deploy Container to get started.</p>
                </div>
              ) : (
                deployments.map((entry) => {
                  const isOpen = expandedDeployments.has(entry.id);
                  return (
                    <div key={entry.id} className={`log-entry ${entry.status} ${isOpen ? 'open' : ''}`}>
                      <div className="log-header" onClick={() => toggleDeploymentLogs(entry.id)}>
                        <span className="log-badge success">{entry.status}</span>
                        <span className="log-image-tag">{entry.image}:{entry.tag}</span>
                        <span className="log-timestamp">{formatTime(entry.time)}</span>
                        {isOpen ? (
                          <ChevronDown className="log-chevron" size={14} />
                        ) : (
                          <ChevronRight className="log-chevron" size={14} />
                        )}
                      </div>
                      <div className="log-body">
                        {entry.status === 'success' && entry.data && (
                          <div className="result-grid">
                            <span className="result-key">Container</span>
                            <span className="result-val">{entry.data.containerName}</span>
                            <span className="result-key">Domain</span>
                            <span className="result-val">
                              <a href={`http://${entry.data.domain}`} target="_blank" rel="noopener noreferrer">
                                {entry.data.domain} <ExternalLink size={10} style={{ display: 'inline', marginLeft: '2px' }} />
                              </a>
                            </span>
                          </div>
                        )}
                        {entry.status === 'error' && (
                          <div className="error-msg">{entry.error}</div>
                        )}
                        {entry.status === 'pending' && (
                          <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '12px', fontFamily: 'var(--mono)' }}>
                            Pulling image and starting container…
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: CONTAINERS VIEW */}
          {activeTab === 'containers' && (
            <div className="output-body" style={{ display: 'block', padding: 0 }}>
              <div className="containers-split">
                {/* Left panel: Containers List */}
                <div className="containers-list-panel">
                  <div className="containers-list-header">
                    <div className="search-wrap">
                      <Search className="search-icon" size={12} />
                      <input
                        type="text"
                        placeholder="Filter containers..."
                        value={containerSearch}
                        onChange={(e) => setContainerSearch(e.target.value)}
                        autoComplete="off"
                        spellCheck="false"
                      />
                    </div>
                    <button
                      className="btn-sm btn-icon"
                      onClick={fetchContainers}
                      title="Refresh containers list"
                      disabled={isFetchingContainers}
                    >
                      <RefreshCw size={12} className={isFetchingContainers ? 'spin' : ''} />
                    </button>
                  </div>

                  <div className="containers-list">
                    {isFetchingContainers && containers.length === 0 ? (
                      <div style={{ padding: '20px', color: 'var(--muted)', fontSize: '12px', fontFamily: 'var(--mono)', textAlign: 'center' }}>
                        Fetching Docker containers...
                      </div>
                    ) : filteredContainers.length === 0 ? (
                      <div style={{ padding: '40px 20px', color: 'var(--muted)', fontSize: '12px', textAlign: 'center', lineHeight: '1.5' }}>
                        {containers.length === 0 ? 'No Docker containers found in the system.' : 'No matching containers found.'}
                      </div>
                    ) : (
                      filteredContainers.map((c) => {
                        const isSelected = c.id === selectedContainerId;
                        const statusClass = c.state === 'running' ? 'running' : c.state === 'exited' ? 'exited' : 'other';

                        return (
                          <div
                            key={c.id}
                            className={`container-item ${isSelected ? 'active' : ''}`}
                            onClick={() => selectContainer(c.id)}
                          >
                            <div className="container-item-header">
                              <span className="container-item-name" title={c.name}>{c.name}</span>
                              <span className={`container-status-badge ${statusClass}`}>{c.state}</span>
                            </div>
                            <div className="container-item-image" title={c.image}>{c.image}</div>
                            <div className="container-item-meta">
                              <span>Ports: {formatPorts(c.ports)}</span>
                              <span style={{ fontSize: '10px' }}>{c.status}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right panel: Logs Console */}
                <div className="logs-panel">
                  <div className="logs-header">
                    <div className="logs-title-wrap">
                      <span className={`logs-indicator ${isSelectedRunning ? 'active' : ''}`}></span>
                      <h3>{selectedContainer ? selectedContainer.name : 'Select a container'}</h3>
                    </div>
                    <div className="logs-actions">
                      <div className="auto-refresh-toggle">
                        <input
                          type="checkbox"
                          id="autoRefreshCheck"
                          checked={isLogsAutoRefresh}
                          onChange={(e) => setIsLogsAutoRefresh(e.target.checked)}
                        />
                        <label
                          htmlFor="autoRefreshCheck"
                          style={{ textTransform: 'none', fontSize: '11px', cursor: 'pointer', letterSpacing: 0, userSelect: 'none' }}
                        >
                          Auto-refresh (3s)
                        </label>
                      </div>
                      <button
                        className="btn-sm btn-start"
                        onClick={startSelectedContainer}
                        disabled={!selectedContainerId || isSelectedRunning || actionLoading.start}
                      >
                        {actionLoading.start ? 'Starting...' : 'Start'}
                      </button>
                      <button
                        className="btn-sm btn-stop"
                        onClick={stopSelectedContainer}
                        disabled={!selectedContainerId || !isSelectedRunning || actionLoading.stop}
                      >
                        {actionLoading.stop ? 'Stopping...' : 'Stop'}
                      </button>
                      <button
                        className="btn-sm btn-delete"
                        onClick={deleteSelectedContainer}
                        disabled={!selectedContainerId || actionLoading.delete}
                      >
                        {actionLoading.delete ? 'Deleting...' : 'Delete'}
                      </button>
                      <button
                        className="btn-sm"
                        onClick={copyLogsText}
                        disabled={!selectedContainerId || !logs || actionLoading.copy}
                      >
                        {actionLoading.copy ? 'Copied!' : 'Copy'}
                      </button>
                      <button
                        className="btn-sm"
                        onClick={refreshSelectedLogs}
                        disabled={!selectedContainerId || actionLoading.refresh}
                      >
                        {actionLoading.refresh ? 'Refreshing...' : 'Refresh'}
                      </button>
                    </div>
                  </div>

                  <div className="logs-console" id="logsConsole" ref={logsConsoleRef}>
                    {!selectedContainerId ? (
                      <div className="logs-empty-state">
                        <Terminal size={32} style={{ opacity: 0.3 }} />
                        <p style={{ marginTop: '8px' }}>Select a container from the list to view its real-time log stream.</p>
                      </div>
                    ) : isFetchingLogs && !logs ? (
                      <div style={{ color: 'var(--muted)', fontStyle: 'italic', padding: '12px', fontFamily: 'var(--mono)' }}>
                        Loading container logs...
                      </div>
                    ) : !logs ? (
                      <div style={{ color: 'var(--muted)', fontStyle: 'italic', padding: '12px', fontFamily: 'var(--mono)' }}>
                        No logs available for this container.
                      </div>
                    ) : (
                      logs
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
      )}

      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <div className="toast-content">
              <div className="toast-title">{toast.title}</div>
              <div className="toast-message">{toast.message}</div>
            </div>
            <button className="toast-close" onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export default App;
