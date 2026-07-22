const mongoose = require('mongoose');

// --- Schemas ----------------------------------------------------------------
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // WhatsApp group IDs this user wants monitored.
    selectedGroups: { type: [String], default: [] },
    // Each user can supply their own NVIDIA API key (avoids sharing rate limits).
    nvidiaApiKey: { type: String, default: '' },
  },
  { timestamps: true }
);

const driveSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    company: String,
    role: String,
    ctc: String,
    eligibility: String,
    deadline: String,
    applyLink: String,
    dedupKey: String,
  },
  { timestamps: true }
);
// One drive per (user, dedupKey) — this is what enforces de-duplication.
driveSchema.index({ userId: 1, dedupKey: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const Drive = mongoose.model('Drive', driveSchema);

async function connectMongo(uri) {
  if (!uri) throw new Error('MONGODB_URI is not set.');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');
}

module.exports = { mongoose, connectMongo, User, Drive };
