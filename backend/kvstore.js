const fs = require('fs');
const path = require('path');
const config = require('./config');
const { mongoose, connect } = require('./db');

// Small key/value store for the encrypted Graph token cache and the mail
// watermark. Backed by MongoDB when MONGODB_URI is set (so ephemeral cloud
// disks don't lose them), otherwise a local file in .secrets/.
const kvSchema = new mongoose.Schema({ _id: String, value: String }, { versionKey: false });
let KV;
function model() {
  if (!KV) KV = mongoose.models.kv || mongoose.model('kv', kvSchema);
  return KV;
}

const localDir = path.dirname(config.tokenCachePath); // ./.secrets
function localFile(key) {
  return path.join(localDir, key);
}

async function get(key) {
  if (config.mongoUri) {
    await connect();
    const doc = await model().findById(key).lean();
    return doc ? doc.value : null;
  }
  const f = localFile(key);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

async function set(key, value) {
  if (config.mongoUri) {
    await connect();
    await model().updateOne({ _id: key }, { $set: { value } }, { upsert: true });
    return;
  }
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(localFile(key), value, { mode: 0o600 });
}

module.exports = { get, set };
