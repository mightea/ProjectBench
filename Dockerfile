# ---- Build: install workspace, build web app and server bundle ----
FROM node:26-bookworm-slim AS build
# Node 25+ images no longer include corepack.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/mcp-stdio/package.json apps/mcp-stdio/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
ARG APP_VERSION=0.0.0
ENV APP_VERSION=$APP_VERSION
RUN pnpm build

# ---- Runtime dependencies: only the native SQLite module ----
FROM node:26-bookworm-slim AS runtime-deps
# Build tools are a fallback in case no prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /deps
COPY apps/server/package.json ./server-package.json
RUN npm init -y >/dev/null \
 && npm install --omit=dev "better-sqlite3@$(node -p "require('./server-package.json').dependencies['better-sqlite3']")"

# ---- Final image ----
FROM node:26-bookworm-slim
ARG APP_VERSION=0.0.0
ENV APP_VERSION=$APP_VERSION \
    NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787
WORKDIR /app
COPY --from=runtime-deps /deps/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
