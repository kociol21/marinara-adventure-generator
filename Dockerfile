# Marinara Adventure Generator in a container.
# Build and run with docker compose (see README, "Docker"); the port is published on the
# host's loopback only, because the app holds API keys and spoilers.

FROM node:24-trixie-slim

RUN npm install --global pnpm@12.15.0 && npm cache clean --force

WORKDIR /app

# Dependencies first, so code changes reuse this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
RUN pnpm build && mkdir -p /data && chown node:node /data

USER node

# Listen on all interfaces inside the container only; keys go to /data/secrets.json because
# a container has no OS credential store.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7880 \
    DATA_DIR=/data \
    SECRET_STORE=file

VOLUME ["/data"]
EXPOSE 7880

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Run the server directly (not through pnpm) so it receives stop signals.
WORKDIR /app/packages/server
CMD ["node", "--import", "tsx", "src/index.ts", "--production"]
