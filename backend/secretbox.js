const crypto = require('crypto');

// Reversible encryption for secrets we must reuse (e.g. a user's NVIDIA API key).
// AES-256-GCM with a server-side key, so a leaked DB dump is useless without it.
// (Passwords use bcrypt — one-way. API keys can't be hashed because we call the API.)
function key() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set to encrypt secrets.');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // "enc:" marks a ciphertext so we can tell it apart from any legacy plaintext.
  return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(stored) {
  if (!stored) return '';
  if (!stored.startsWith('enc:')) return stored; // legacy/plaintext — return as-is
  try {
    const raw = Buffer.from(stored.slice(4), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { encrypt, decrypt };
