# Backend: Express + Socket.io + SQLite + whatsapp-web.js (headless Chromium).
FROM node:22-bookworm-slim

# Chromium for Puppeteer + build tools for the native sqlite3 module.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    dumb-init \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Non-root user; session data persists only while the instance lives (Render free
# tier has an ephemeral disk — see DEPLOY notes).
RUN useradd -m appuser \
  && mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache \
  && chown -R appuser:appuser /app
USER appuser

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
