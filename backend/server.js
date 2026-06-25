import Docker from "dockerode";
import dotenv from "dotenv";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import httpProxy from "http-proxy";
import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate, JWT_SECRET } from "./utils/authenticate.js";
import { pullImagePromisified } from "./utils/pull-image.js";

dotenv.config();

const MANAGEMENT_API_PORT = process.env.MANAGEMENT_API_PORT ?? 5000;
const REVERSE_PROXY_HOST = process.env.REVERSE_PROXY_HOST ?? "localhost";
const LOGIN_USERNAME = process.env.LOGIN_USERNAME || "admin";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || "admin";
if (!process.env.LOGIN_USERNAME || !process.env.LOGIN_PASSWORD) {
  console.warn("WARNING: Using default admin credentials. Please define LOGIN_USERNAME and LOGIN_PASSWORD in .env.");
}

const DOCKER_NETWORK_NAME = process.env.DOCKER_NETWORK_NAME || "deploy-engine-network";

const managementApp = express();
const proxyApp = express();

const proxy = httpProxy.createProxy();
const docker = new Docker();

// ── SECURITY MIDDLEWARE ──
// managementApp.use(
//   helmet({
//     contentSecurityPolicy: {
//       directives: {
//         defaultSrc: ["'self'"],
//         scriptSrc: ["'self'", "'unsafe-inline'"],
//         styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
//         fontSrc: ["'self'", "https://fonts.gstatic.com"],
//         connectSrc: ["'self'", "ws:", "wss:"],
//         imgSrc: ["'self'", "data:", "https:"],
//         objectSrc: ["'none'"],
//         upgradeInsecureRequests: [],
//       },
//     },
//   })
// );

managementApp.use(express.json());

// Serve static frontend files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, "public");
managementApp.use(express.static(publicPath));

// Rate Limiters
const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: { status: "error", message: "Too many login attempts. Please try again after a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { status: "error", message: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper: Ensure network exists
async function ensureNetwork(networkName) {
  try {
    const network = docker.getNetwork(networkName);
    await network.inspect();
    return network;
  } catch (error) {
    if (error.statusCode === 404) {
      console.log(`Network ${networkName} not found, creating it...`);
      return await docker.createNetwork({ Name: networkName, Driver: "bridge" });
    }
    throw error;
  }
}

managementApp.get('/', (req, res) => {
  return res.status(200).json({
    status: "success",
    message: "Deploy Engine is running"
  })
});

managementApp.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
    return res.json({
      status: "success",
      data: { token }
    });
  }
  return res.status(401).json({
    status: "error",
    message: "Invalid username or password"
  });
});

managementApp.post("/container", authenticate, apiLimiter, async (req, res) => {
  try {
    const { image, tag, name } = req.body;

    // Validation
    if (!image || typeof image !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(image)) {
      return res.status(400).json({ status: "error", message: "Invalid image name format." });
    }

    const finalTag = tag ? String(tag).trim() : "latest";
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(finalTag)) {
      return res.status(400).json({ status: "error", message: "Invalid tag format." });
    }

    if (name && !/^[a-z0-9-]{3,63}$/.test(name)) {
      return res.status(400).json({ status: "error", message: "Invalid container name. Only lowercase alphanumeric and hyphens are allowed (3-63 chars)." });
    }

    let isExistingImage = false;
    const systemImages = await docker.listImages();

    for (const systemImage of systemImages) {
      if (systemImage.RepoTags) {
        for (const systemTag of systemImage.RepoTags) {
          if (systemTag === `${image}:${finalTag}`) {
            isExistingImage = true;
            break;
          }
        }
      }
      if (isExistingImage) break;
    }

    if (!isExistingImage) {
      console.log(`Image ${image}:${finalTag} not found locally. Pulling...`);
      await pullImagePromisified(docker, image, finalTag);
    }

    const createOpts = {
      Image: `${image}:${finalTag}`,
      HostConfig: {
        AutoRemove: false,
      },
    };

    if (name) {
      createOpts.name = name;
    }

    console.log(`Creating container ${name || ''} with image ${image}:${finalTag}...`);
    const container = await docker.createContainer(createOpts);

    const network = await ensureNetwork(DOCKER_NETWORK_NAME);

    console.log(`Starting container ${container.id}...`);
    await container.start();

    console.log(`Connecting container ${container.id} to network ${DOCKER_NETWORK_NAME}...`);
    await network.connect({
      Container: container.id,
    });

    const inspect = await container.inspect();
    const cleanName = inspect.Name.replace(/^\//, "");

    return res.json({
      status: "success",
      data: {
        containerName: cleanName,
        domain: `${cleanName}.${REVERSE_PROXY_HOST}`,
      },
    });
  } catch (error) {
    console.error("Error creating/starting container:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to deploy container",
    });
  }
});

managementApp.get("/containers", authenticate, apiLimiter, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const formatted = containers.map(container => {
      const name = container.Names && container.Names.length > 0
        ? container.Names[0].replace(/^\//, "")
        : container.Id.slice(0, 12);

      return {
        id: container.Id,
        name: name,
        image: container.Image,
        state: container.State,
        status: container.Status,
        ports: container.Ports || []
      };
    });
    return res.json({
      status: "success",
      data: formatted
    });
  } catch (error) {
    console.error("Error listing containers:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to list containers"
    });
  }
});

managementApp.get("/containers/:id/logs", authenticate, apiLimiter, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const inspect = await container.inspect();
    const isTty = inspect.Config.Tty;

    const tailQuery = req.query.tail ? parseInt(req.query.tail, 10) : 200;
    const tail = isNaN(tailQuery) ? 200 : Math.min(Math.max(1, tailQuery), 1000);

    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail: tail,
      follow: false
    });

    let logsText = "";
    if (isTty) {
      logsText = logsBuffer.toString("utf8");
    } else {
      let offset = 0;
      while (offset < logsBuffer.length) {
        if (offset + 8 > logsBuffer.length) {
          break;
        }
        const size = logsBuffer.readUInt32BE(offset + 4);
        const payloadEnd = Math.min(logsBuffer.length, offset + 8 + size);
        const payload = logsBuffer.toString("utf8", offset + 8, payloadEnd);
        logsText += payload;
        offset += 8 + size;
      }
    }

    return res.json({
      status: "success",
      data: {
        logs: logsText
      }
    });
  } catch (error) {
    console.error("Error getting container logs:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch container logs"
    });
  }
});

managementApp.post("/containers/:id/stop", authenticate, apiLimiter, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.stop();
    return res.json({
      status: "success",
      message: "Container stopped successfully"
    });
  } catch (error) {
    if (error.statusCode === 304) {
      return res.json({
        status: "success",
        message: "Container is already stopped"
      });
    }
    console.error("Error stopping container:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to stop container"
    });
  }
});

managementApp.post("/containers/:id/start", authenticate, apiLimiter, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.start();
    return res.json({
      status: "success",
      message: "Container started successfully"
    });
  } catch (error) {
    if (error.statusCode === 304) {
      return res.json({
        status: "success",
        message: "Container is already running"
      });
    }
    console.error("Error starting container:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to start container"
    });
  }
});

managementApp.delete("/containers/:id", authenticate, apiLimiter, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.remove({ force: true });
    return res.json({
      status: "success",
      message: "Container deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting container:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to delete container"
    });
  }
});

// SPA fallback routing
managementApp.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/login") && !req.path.startsWith("/container") && !req.path.startsWith("/containers")) {
    return res.sendFile(path.join(publicPath, "index.html"), (err) => {
      if (err) {
        res.status(200).send("Deploy Engine is running");
      }
    });
  }
  next();
});

// Centralized error-handling middleware
managementApp.use((err, req, res, next) => {
  console.error("Centralized Error Handler caught an error:", err);
  res.status(err.status || 500).json({
    status: "error",
    message: err.message || "Internal Server Error"
  });
});

managementApp.listen(MANAGEMENT_API_PORT, () => {
  console.log(`ManagementAPI is running on PORT ${MANAGEMENT_API_PORT}`);
});

proxyApp.use((req, res) => {
  const containerName = req.hostname.split(".")[0];
  return proxy.web(req, res, {
    target: `http://${containerName}:80`,
  });
});

// http-proxy error handler to prevent crashing if target is unreachable
proxy.on("error", (err, req, res) => {
  console.error("Reverse proxy connection error:", err.message);
  if (!res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", message: "Bad Gateway: Dynamic container is stopped or unreachable." }));
  }
});

proxyApp.listen(80, () => {
  console.log(`Reverse Proxy is running on PORT 80`);
});
