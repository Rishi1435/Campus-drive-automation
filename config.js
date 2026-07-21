// Central configuration. All secrets come from environment variables (.env locally,
// real env vars on the server). Nothing sensitive is hard-coded here.
require('dotenv').config();

function csv(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  // --- WhatsApp: privacy whitelist ---------------------------------------
  // ONLY messages from these group/chat IDs are ever parsed. Personal chats
  // are ignored outright, so private messages are never sent to the LLM.
  // Get the IDs by running:  node tools/list-groups.js
  // IDs look like "1203630xxxxxxxxx@g.us" for groups.
  whatsappAllowedChats: csv('WA_ALLOWED_CHATS'),

  // Secondary safety net: even inside allowed groups, require a keyword match.
  // Set WA_REQUIRE_KEYWORDS=false to accept every message in allowed groups.
  requireKeywords: (process.env.WA_REQUIRE_KEYWORDS || 'true') !== 'false',
  keywords: csv('KEYWORDS').length
    ? csv('KEYWORDS')
    : ['campus', 'drive', 'hiring', 'placement', 'ctc', 'recruit', 'internship', 'job opening'],

  // --- Outlook / Microsoft Graph -----------------------------------------
  graph: {
    clientId: process.env.MS_CLIENT_ID,
    // "consumers" for personal Outlook.com accounts, "common" to allow both
    // personal and work/school, or your tenant ID for a single org account.
    authority: `https://login.microsoftonline.com/${process.env.MS_TENANT || 'consumers'}`,
    scopes: ['Mail.Read', 'Files.ReadWrite', 'offline_access', 'User.Read'],
  },

  // Which mail folder to poll, and how often (ms).
  mail: {
    folder: process.env.MAIL_FOLDER || 'Inbox',
    pollIntervalMs: Number(process.env.MAIL_POLL_MS || 5 * 60 * 1000), // 5 min
    // Only mails whose subject/body contains one of these are parsed.
    keywords: csv('MAIL_KEYWORDS').length ? csv('MAIL_KEYWORDS') : csv('KEYWORDS'),
  },

  // --- Google Sheet via Apps Script web app (no GCP / service account) --------
  appsScript: {
    url: process.env.GAS_WEBAPP_URL || '', // the deployed web app URL
    token: process.env.GAS_TOKEN || '', // shared secret; must match TOKEN in AppsScript.gs
  },

  // --- Google Sheets via service account (alternative, unused) ----------------
  google: {
    // The spreadsheet ID from the sheet's URL:
    //   https://docs.google.com/spreadsheets/d/<THIS_PART>/edit
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    // Tab (worksheet) name inside the spreadsheet.
    tab: process.env.GOOGLE_SHEET_TAB || 'Campus Drives',
    // Service-account credentials: either the raw JSON in GOOGLE_CREDENTIALS_JSON
    // (best for cloud env vars) or a path to the .json key file.
    credentialsJson: process.env.GOOGLE_CREDENTIALS_JSON || '',
    credentialsFile: process.env.GOOGLE_CREDENTIALS_FILE || './.secrets/google-service-account.json',
  },

  // --- Online Excel workbook (in your OneDrive) --------------------------
  excel: {
    // Path of the .xlsx inside your OneDrive, e.g. "/Documents/campus_drives.xlsx".
    filePath: process.env.EXCEL_FILE_PATH || '/campus_drives.xlsx',
    worksheet: process.env.EXCEL_WORKSHEET || 'Campus Drives',
    table: process.env.EXCEL_TABLE || 'CampusDrives',
  },

  // MongoDB connection string (Atlas free tier works, no card needed). When set,
  // the WhatsApp session + token cache live in the DB so ephemeral cloud disks
  // (Render/Koyeb) don't wipe them. Leave blank to store everything on local disk.
  mongoUri: process.env.MONGODB_URI || '',

  // Local fallback location for the encrypted Graph token cache (used only when
  // MONGODB_URI is not set). Its directory also holds other local kv files.
  tokenCachePath: process.env.TOKEN_CACHE_PATH || './.secrets/graph_token_cache.enc',

  // HTTP port for the keep-alive/health endpoint (Render sets PORT for you).
  port: Number(process.env.PORT || 3000),
  // Key used to encrypt the token cache at rest. MUST be set on the server.
  secretKey: process.env.APP_SECRET_KEY || '',
};

// Column order for the spreadsheet / table.
config.columns = [
  'company',
  'role',
  'ctc',
  'eligibility',
  'deadline',
  'applyLink',
  'source',
  'dedupKey',
  'timestamp',
];

module.exports = config;
