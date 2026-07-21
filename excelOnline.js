const ExcelJS = require('exceljs');
const { getAccessToken } = require('./graphAuth');
const { dedupKey } = require('./dedup');
const config = require('./config');

const GRAPH = 'https://graph.microsoft.com/v1.0';
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

// Column letter for a 1-based index (1 -> A). We stay well under 26 columns.
function colLetter(n) {
  return String.fromCharCode(64 + n);
}

// Path prefix to address the workbook file in the user's OneDrive.
function driveItem() {
  const p = config.excel.filePath.startsWith('/')
    ? config.excel.filePath
    : '/' + config.excel.filePath;
  return `/me/drive/root:${encodeURI(p)}:`;
}

async function graph(pathAndQuery, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(GRAPH + pathAndQuery, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Graph ${res.status} on ${pathAndQuery}: ${body}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.arrayBuffer();
}

// Create the workbook in OneDrive with just a header row if it doesn't exist.
async function ensureFile() {
  try {
    await graph(`${driveItem()}`);
    return; // exists
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  console.log('Creating workbook in OneDrive:', config.excel.filePath);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(config.excel.worksheet);
  ws.addRow(COLS.map((c) => HEADERS[c]));
  const buf = await wb.xlsx.writeBuffer();
  const token = await getAccessToken();
  const res = await fetch(GRAPH + `${driveItem()}/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    body: Buffer.from(buf),
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
}

// Ensure a named table exists over the header row so we can append/read rows.
async function ensureTable() {
  try {
    await graph(`${driveItem()}/workbook/tables/${config.excel.table}`);
    return;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const last = colLetter(COLS.length);
  const address = `${config.excel.worksheet}!A1:${last}1`;
  const created = await graph(`${driveItem()}/workbook/tables/add`, {
    method: 'POST',
    body: JSON.stringify({ address, hasHeaders: true }),
  });
  await graph(`${driveItem()}/workbook/tables/${created.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: config.excel.table }),
  });
  console.log('Created Excel table:', config.excel.table);
}

// Load existing dedup keys so we never write the same drive twice.
async function loadExistingKeys() {
  const keyIdx = COLS.indexOf('dedupKey');
  const data = await graph(`${driveItem()}/workbook/tables/${config.excel.table}/rows`);
  const set = new Set();
  for (const row of data.value || []) {
    const v = row.values && row.values[0] && row.values[0][keyIdx];
    if (v) set.add(String(v));
  }
  return set;
}

let existingKeys = new Set();

async function init() {
  await ensureFile();
  await ensureTable();
  existingKeys = await loadExistingKeys();
  console.log(`Excel Online ready. ${existingKeys.size} existing rows loaded.`);
}

// Append a drive if it's new. Returns true if written, false if duplicate.
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
  await graph(`${driveItem()}/workbook/tables/${config.excel.table}/rows/add`, {
    method: 'POST',
    body: JSON.stringify({ values }),
  });
  existingKeys.add(key);
  return true;
}

module.exports = { init, appendIfNew };
