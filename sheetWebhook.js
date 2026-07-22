const { dedupKey } = require('./dedup');
const config = require('./config');

const COLS = config.columns;

// Storage backend: posts each new drive to a Google Apps Script web app bound to
// your Sheet. Dedup happens inside the script (checks the DedupKey column), so it
// stays correct even across restarts — no service account or GCP project needed.
async function init() {
  if (!config.appsScript.url) {
    throw new Error('GAS_WEBAPP_URL is not set. Paste your Apps Script web app URL into .env (see DEPLOY.md §1).');
  }
  try {
    const res = await fetch(config.appsScript.url, { method: 'GET' });
    const out = await res.json().catch(() => ({}));
    if (out && out.ok) console.log('Google Sheet webhook reachable.');
    else console.warn('Google Sheet webhook responded unexpectedly:', res.status);
  } catch (e) {
    console.warn('Could not reach the Sheet webhook (will still try on writes):', e.message);
  }
}

// Append a drive if new. Returns true if written, false if duplicate.
async function appendIfNew(data, source) {
  const key = dedupKey(data);
  const row = {
    ...data,
    source: source || data.source || '',
    dedupKey: key,
    timestamp: new Date().toISOString(),
  };
  const values = COLS.map((c) => (row[c] == null ? '' : String(row[c])));

  const res = await fetch(config.appsScript.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.appsScript.token, dedupKey: key, values }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) {
    throw new Error(`Sheet webhook failed: ${res.status} ${JSON.stringify(out)}`);
  }
  return out.added === true;
}

module.exports = { init, appendIfNew };
