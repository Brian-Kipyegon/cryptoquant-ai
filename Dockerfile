# syntax=docker/dockerfile:1

# Override to use a registry mirror, e.g. public.ecr.aws/docker/library/node:24-slim
ARG NODE_IMAGE=node:24-slim

# ---- build: install all dependencies and build the frontend ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: production dependencies, built frontend and server source ----
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server.ts index.html ./
COPY server ./server
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/auth/session').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "scripts/run-server.mjs", "production"]
