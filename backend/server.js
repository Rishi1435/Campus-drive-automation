const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { parseDriveData } = require('./parser');
const { encrypt, decrypt } = require('./secretbox');
const { mongoose, connectMongo, User, Drive } = require('./mongo');
const { createWhatsApp } = require('./wa');
require('dotenv').config();

// Keep the server alive through any stray library-level rejection/exception so a
// single user's WhatsApp hiccup can never take the whole process down.
process.on('unhandledRejection', (r) => console.error('Unhandled rejection:', (r && r.message) || r));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', (e && e.message) || e));

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Refuse to run in production with a weak/default signing secret.
if (IS_PROD && (!process.env.JWT_SECRET || JWT_SECRET === 'dev-only-secret-change-me')) {
  console.error('FATAL: set a strong JWT_SECRET in production.');
  process.exit(1);
}

// Lock CORS to your frontend origin(s) if provided, otherwise allow all (dev).
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });

// WhatsApp engine (Baileys — no browser). Handles one socket per user, emits the
// whatsapp_* socket.io events the frontend listens for, and captures drives.
const wa = createWhatsApp({ io, mongoose, User, Drive, parseDriveData, decrypt, dedupKeyFor });

app.set('trust proxy', 1); // behind Render's proxy — needed for correct client IPs
// Security headers. It's a JSON API consumed cross-origin by the frontend, so no
// CSP and an explicit cross-origin resource policy.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// Throttle auth endpoints to blunt brute-force / credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
app.use('/api/auth', authLimiter);

// --- Auth helpers -----------------------------------------------------------
function signToken(user) {
  return jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

function dedupKeyFor(parsed) {
  const basis = `${parsed.company || ''}-${parsed.role || ''}-${parsed.deadline || ''}`
    .toLowerCase()
    .replace(/\s+/g, '');
  return crypto.createHash('sha256').update(basis).digest('hex');
}

// --- Auth routes ------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';
    if (!email || password.length < 6) {
      return res.status(400).json({ error: 'Enter an email and a password of at least 6 characters.' });
    }
    if (await User.findOne({ email })) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });
    res.json({ token: signToken(user), user: { id: user._id, email: user.email } });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    res.json({ token: signToken(user), user: { id: user._id, email: user.email } });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

// --- Data routes (auth derived from token, not the URL) ---------------------
app.get('/api/drives', requireAuth, async (req, res) => {
  const drives = await Drive.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
  res.json(
    drives.map((d) => ({
      id: d._id,
      company: d.company,
      role: d.role,
      ctc: d.ctc,
      eligibility: d.eligibility,
      deadline: d.deadline,
      applyLink: d.applyLink,
      applied: !!d.applied,
    }))
  );
});

// Toggle whether the user has applied to a drive.
app.patch('/api/drives/:id/applied', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const applied = !!req.body.applied;
    const drive = await Drive.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId }, // scoped to the owner
      { applied },
      { new: true }
    );
    if (!drive) return res.status(404).json({ error: 'Drive not found' });
    res.json({ success: true, applied });
  } catch (e) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    email: user.email,
    selectedGroups: user.selectedGroups || [],
    hasApiKey: !!user.nvidiaApiKey,
  });
});

// Save (or clear) the user's own NVIDIA API key. Stored ENCRYPTED at rest and
// never sent back to any client (only a hasApiKey flag).
app.post('/api/apikey', requireAuth, async (req, res) => {
  try {
    const raw = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '';
    await User.findByIdAndUpdate(req.userId, { nvidiaApiKey: raw ? encrypt(raw) : '' });
    res.json({ success: true, hasApiKey: !!raw });
  } catch (e) {
    res.status(500).json({ error: 'Could not save key.' });
  }
});

app.post('/api/groups', requireAuth, async (req, res) => {
  const { selectedGroups } = req.body;
  if (!Array.isArray(selectedGroups)) {
    return res.status(400).json({ error: 'selectedGroups must be an array' });
  }
  await User.findByIdAndUpdate(req.userId, { selectedGroups });
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeClients: wa.count() });
});

// --- Socket.io: authenticated via JWT in the handshake ----------------------
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    socket.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  socket.join(userId);

  // Reflect current WhatsApp state to a freshly-opened dashboard.
  const st = wa.getState(userId);
  if (st && st.ready) {
    socket.emit('whatsapp_status', 'connected');
    wa.emitGroupsTo(socket, userId);
  } else if (st && st.failed) {
    socket.emit('whatsapp_status', 'error');
    socket.emit('whatsapp_error', st.error || 'WhatsApp failed to start — tap Retry.');
  } else if (st) {
    // Still connecting — resend the last QR if we already have one.
    socket.emit('whatsapp_status', 'initializing');
    if (st.lastQr) socket.emit('whatsapp_qr', st.lastQr);
  } else {
    wa.ensureFor(userId);
  }

  socket.on('refresh_groups', () => wa.refreshGroups(userId));
  socket.on('logout_whatsapp', () => wa.logout(userId));
  socket.on('restart_whatsapp', () => wa.restart(userId));
  socket.on('disconnect', () => {});
});

// --- Keep-alive (stops Render's free instance from sleeping) -----------------
// Render sets RENDER_EXTERNAL_URL to the service's public URL. Pinging our own
// /api/health every ~10 min counts as inbound traffic and prevents idle sleep.
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  setInterval(() => {
    fetch(`${url}/api/health`).catch(() => {});
  }, 10 * 60 * 1000);
  console.log('Keep-alive ping enabled for', url);
}

// --- Boot -------------------------------------------------------------------
connectMongo(process.env.MONGODB_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    startKeepAlive();
    // Resume WhatsApp for users with a saved session + configured groups, so
    // capture continues even with no dashboard open.
    wa.resumeSessions();
  })
  .catch((e) => {
    console.error('Failed to connect to MongoDB:', e.message);
    process.exit(1);
  });

module.exports = { app, server, io };
