const mongoose = require('mongoose');
const config = require('./config');

let connPromise = null;

// Connect once to MongoDB (used for the WhatsApp session store + key/value cache).
// If MONGODB_URI isn't set, everything falls back to local disk (Option A).
function connect() {
  if (!config.mongoUri) return Promise.resolve(null);
  if (!connPromise) {
    mongoose.set('strictQuery', true);
    connPromise = mongoose
      .connect(config.mongoUri)
      .then(() => {
        console.log('MongoDB connected.');
        return mongoose.connection;
      })
      .catch((e) => {
        connPromise = null;
        throw e;
      });
  }
  return connPromise;
}

module.exports = { mongoose, connect };
