# Stage 1: Build frontend
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY src/dashboard/frontend/package*.json ./
RUN npm ci
COPY src/dashboard/frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
# Overlay built frontend into source tree before tsc
COPY --from=frontend /app/frontend/dist ./src/dashboard/frontend/dist/
RUN npx tsc

# Stage 3: Runtime
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=backend /app/dist ./dist/
COPY --from=frontend /app/frontend/dist ./dist/dashboard/frontend/dist/

# Create Zora state directories
RUN mkdir -p /root/.zora/workspace \
             /root/.zora/memory/daily \
             /root/.zora/memory/items \
             /root/.zora/memory/categories \
             /root/.zora/audit \
             /root/.zora/state

# Default config for container (can be overridden with volume mount)
COPY docker/config.toml /root/.zora/config.toml
COPY docker/policy.toml /root/.zora/policy.toml

ENV ZORA_BIND_HOST=0.0.0.0
EXPOSE 8070

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8070/api/health || exit 1

CMD ["node", "dist/cli/daemon.js"]
