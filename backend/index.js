const http = require('http');
const config = require('./config');
const { parseDriveData } = require('./parser');
const store = require('./sheetWebhook');
const { startWhatsapp } = require('./whatsapp');

let lastActivity = new Date().toISOString();

// Tiny keep-alive/health endpoint. Render needs the service to bind a port, and
// a free uptime pinger (e.g. UptimeRobot) can hit this URL to stop it sleeping.
function startHealthServer() {
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', lastActivity }));
    })
    .listen(config.port, () => console.log(`Health endpoint on :${config.port}`));
}

// Parse one message and write it to the online sheet if it's new.
async function handleDrive({ text, base64Image, source }) {
  const parsed = await parseDriveData(text, base64Image);
  if (!parsed || (!parsed.company && !parsed.role)) {
    console.log(`[${source}] No usable drive data extracted.`);
    return;
  }
  const written = await store.appendIfNew(parsed, source);
  lastActivity = new Date().toISOString();
  console.log(
    `[${source}] ${written ? 'ADDED' : 'duplicate, skipped'}: ${parsed.company || '?'} / ${parsed.role || '?'}`
  );
}

async function main() {
  console.log('Starting Campus Drive Automation (WhatsApp -> Google Sheets)...');

  // 0) Keep-alive endpoint (needed for Render's free web service + uptime pings).
  startHealthServer();

  // 1) Connect the online Google Sheet.
  await store.init();

  // 2) Start the WhatsApp listener (whitelisted groups only).
  await startWhatsapp(handleDrive);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
