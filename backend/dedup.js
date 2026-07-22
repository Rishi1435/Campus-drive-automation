const crypto = require('crypto');

// Normalize a value for comparison: lowercase, collapse whitespace, strip noise.
function norm(v) {
  if (v == null) return '';
  return String(v).toLowerCase().replace(/\s+/g, ' ').trim();
}

// A drive is considered a duplicate if company + role + deadline match.
// We hash them into a short stable key stored in its own column so future
// runs can dedup with a simple string compare (fast, no fuzzy matching needed).
function dedupKey(data) {
  const basis = [norm(data.company), norm(data.role), norm(data.deadline)].join('|');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

module.exports = { dedupKey, norm };
