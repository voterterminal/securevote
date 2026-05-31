# ==========================================
# VoteTerminal — Dockerfile
# ==========================================
# Multi-stage build: keeps the final image small and production-safe.
#
# Build:   docker build -t voterterminal .
# Run:     docker compose up -d  (see docker-compose.yml)
# ==========================================

# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files and install deps
COPY voting-app/package*.json ./
RUN npm ci --silent

# Copy source and build
COPY voting-app/ ./
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL
RUN npm run build

# ── Stage 2: Production Node.js backend ──────────────────────────────────────
FROM node:20-alpine AS backend

# Security: run as non-root
RUN addgroup -S voterterm && adduser -S voterterm -G voterterm

WORKDIR /app

# Install backend dependencies first (layer cache friendly)
COPY package*.json ./
RUN npm ci --omit=dev --silent

# Copy backend source
COPY voting-app-server.js ./
COPY email-service.js ./

# Copy built React app from stage 1
COPY --from=frontend-builder /app/frontend/build ./public

# Ensure the non-root user owns everything
RUN chown -R voterterm:voterterm /app

USER voterterm

EXPOSE 3001

# Healthcheck — Apache/nginx will also check this
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "voting-app-server.js"]
