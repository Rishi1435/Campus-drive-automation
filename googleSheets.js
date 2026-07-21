const fs = require('fs');
const { google } = require('googleapis');
const { dedupKey } = require('./dedup');
const config = require('./config');

const COLS = config.columns;
const HEADERS = {
  company: 'Company',
  role: 'Role',
  ctc: 'CTC',
  eligibility: 'Eligibility',
  deadline: 'Deadline',
  applyLink: 'Apply Link',
  source: 'Source',
  dedupKey: 'DedupKey',
  timestamp: 'Timestamp',
};

function loadCredentials() {
  if (config.google.credentialsJson) {
    return JSON.parse(config.google.credentialsJson);
  }
  if (fs.existsSync(config.google.credentialsFile)) {
    return JSON.parse(fs.readFileSync(config.google.credentialsFile, 'utf8'));
  }
  throw new Error(
    'No Google credentials. Set GOOGLE_CREDENTIALS_JSON or place the service-account ' +
      'key at ' + config.google.credentialsFile + ' (see DEPLOY.md).'
  );
}

let sheetsApi;
let existingKeys = new Set();

async function client() {
  if (sheetsApi) return sheetsApi;
  const creds = loadCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

const tab = () => config.google.tab;

// Make sure the tab exists and has our header row.
async function ensureSheet() {
  const sheets = await client();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.google.sheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === tab());
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.google.sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab() } } }] },
    });
  }

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: `${tab()}!A1:1`,
  });
  if (!header.data.values || header.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: `${tab()}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [COLS.map((c) => HEADERS[c])] },
    });
  }
}

// Load existing dedup keys so the same drive is never written twice.
async function loadExistingKeys() {
  const sheets = await client();
  const keyCol = String.fromCharCode(65 + COLS.indexOf('dedupKey')); // e.g. 'H'
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: `${tab()}!${keyCol}2:${keyCol}`,
  });
  const set = new Set();
  for (const row of res.data.values || []) {
    if (row[0]) set.add(String(row[0]));
  }
  return set;
}

async function init() {
  if (!config.google.sheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set. See DEPLOY.md for setup.');
  }
  await ensureSheet();
  existingKeys = await loadExistingKeys();
  console.log(`Google Sheets ready. ${existingKeys.size} existing rows loaded.`);
}

// Append a drive if new. Returns true if written, false if duplicate.
async function appendIfNew(data, source) {
  const key = dedupKey(data);
  if (existingKeys.has(key)) return false;

  const row = {
    ...data,
    source: source || data.source || '',
    dedupKey: key,
    timestamp: new Date().toISOString(),
  };
  const values = [COLS.map((c) => (row[c] == null ? '' : String(row[c])))];
  const sheets = await client();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetId,
    range: `${tab()}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  existingKeys.add(key);
  return true;
}

module.exports = { init, appendIfNew };
