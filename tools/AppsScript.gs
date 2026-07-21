/**
 * Campus Drive — Google Sheet webhook.
 *
 * SETUP (see DEPLOY.md §1):
 *  1. Open your Google Sheet → Extensions → Apps Script.
 *  2. Delete anything there, paste ALL of this file, and Save.
 *  3. Deploy → New deployment → type "Web app":
 *        Execute as: Me
 *        Who has access: Anyone
 *     Deploy, authorize, and COPY the Web app URL → put it in .env as GAS_WEBAPP_URL.
 *
 * The TOKEN below must match GAS_TOKEN in your .env. Replace the placeholder with
 * your own random secret (generate one:
 *   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
 * ) and put the SAME value in .env as GAS_TOKEN.
 */
const TOKEN = 'REPLACE_WITH_YOUR_GAS_TOKEN';

const HEADERS = ['Company', 'Role', 'CTC', 'Eligibility', 'Deadline', 'Apply Link', 'Source', 'DedupKey', 'Timestamp'];
const DEDUP_COL = 8; // 1-based column index of "DedupKey"

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) return json({ ok: false, error: 'unauthorized' });

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

    const key = String(body.dedupKey || '');
    if (key) {
      const last = sheet.getLastRow();
      if (last > 1) {
        const keys = sheet.getRange(2, DEDUP_COL, last - 1, 1).getValues();
        for (let i = 0; i < keys.length; i++) {
          if (String(keys[i][0]) === key) return json({ ok: true, added: false });
        }
      }
    }

    sheet.appendRow(body.values);
    return json({ ok: true, added: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'campus-drive-sheet' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
