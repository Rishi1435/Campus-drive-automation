# Backend: Express + Socket.io + Baileys (WhatsApp over WebSocket — NO browser).
# No Chromium, so the image is small and the process fits a free 512 MB instance.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Non-root user. The WhatsApp session lives in MongoDB (not on disk), so it
# survives restarts even though Render's free disk is ephemeral.
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
