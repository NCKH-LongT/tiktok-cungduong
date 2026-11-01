FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run db:generate && npm run build -w @cd/shared && npm run build -w @cd/worker

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/sprite-venv && /opt/sprite-venv/bin/pip install --no-cache-dir Pillow==10.4.0 numpy==1.26.4 opencv-python-headless==4.10.0.84
ENV PATH="/opt/sprite-venv/bin:${PATH}"
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production
USER node
CMD ["node", "apps/worker/dist/battle-assets.js"]
