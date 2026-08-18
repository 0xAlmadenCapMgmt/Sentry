# Sentry402 — portable image. node:sqlite is built into Node >= 22.5 (no native
# build step, no compiler needed). Consumed by any host (Lightsail, ECS, Fly, etc.).

# --- deps: install production node_modules only ---
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js agent.js ./
COPY src ./src
COPY public ./public

# DB lives on a mounted volume in the cloud; default path is under /data.
# Ingestion writes here on boot (or a scheduled job / `npm run ingest` does).
ENV DB_PATH=/data/sentry402.db
ENV PORT=4023
RUN mkdir -p /data && chown -R node:node /data /app

# Drop root.
USER node

EXPOSE 4023

# Lightweight liveness probe against the free health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4023)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
