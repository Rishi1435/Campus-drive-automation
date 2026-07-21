# Node + a system Chromium so whatsapp-web.js works headless on a server.
FROM node:22-bookworm-slim

# Chromium and the libraries Puppeteer needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Run as an unprivileged user; persist session/secrets to a mounted volume.
RUN useradd -m appuser \
  && mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache /app/.secrets \
  && chown -R appuser:appuser /app
USER appuser

# dumb-init reaps the zombie Chromium processes Puppeteer can leave behind.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
