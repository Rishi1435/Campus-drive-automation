const { getAccessToken } = require('./graphAuth');
const kv = require('./kvstore');
const config = require('./config');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const WATERMARK_KEY = 'mail_watermark';

async function readWatermark() {
  return (await kv.get(WATERMARK_KEY)) || ''; // first run: no watermark
}

async function writeWatermark(iso) {
  await kv.set(WATERMARK_KEY, iso);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesKeywords(text) {
  const lower = text.toLowerCase();
  return config.mail.keywords.some((k) => lower.includes(k.toLowerCase()));
}

async function graph(pathAndQuery) {
  const token = await getAccessToken();
  const res = await fetch(GRAPH + pathAndQuery, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fetch new, placement-related mails since the last watermark. Returns an array
// of { subject, text, from, receivedDateTime }. Personal mail is filtered out by
// the keyword check; only Mail.Read scope is used (read-only, no deletes/sends).
async function fetchNewPlacementMails() {
  const since = await readWatermark();
  const folder = encodeURIComponent(config.mail.folder);
  let query =
    `/me/mailFolders/${folder}/messages` +
    `?$select=subject,body,bodyPreview,receivedDateTime,from` +
    `&$orderby=receivedDateTime desc&$top=25`;
  if (since) {
    query += `&$filter=receivedDateTime gt ${encodeURIComponent(since)}`;
  }

  const data = await graph(query);
  const messages = data.value || [];
  const results = [];
  let newest = since;

  for (const m of messages) {
    if (!newest || m.receivedDateTime > newest) newest = m.receivedDateTime;
    const bodyText =
      m.body && m.body.contentType === 'html'
        ? stripHtml(m.body.content)
        : (m.body && m.body.content) || m.bodyPreview || '';
    const combined = `${m.subject || ''}\n\n${bodyText}`;
    if (!matchesKeywords(combined)) continue;
    results.push({
      subject: m.subject || '',
      text: combined,
      from: m.from && m.from.emailAddress ? m.from.emailAddress.address : '',
      receivedDateTime: m.receivedDateTime,
    });
  }

  if (newest && newest !== since) await writeWatermark(newest);
  return results;
}

module.exports = { fetchNewPlacementMails };
