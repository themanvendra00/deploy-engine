# Stage 1: Build the React frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build and run the Express backend
FROM node:24-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
# Copy built frontend assets into the backend's public directory
COPY --from=frontend-builder /frontend/dist ./public

ENV NODE_ENV=production
CMD ["npm", "start"]