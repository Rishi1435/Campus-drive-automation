const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { parseDriveData } = require('./parser');
const { connectMongo, User, Drive } = require('./mongo');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());

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
    }))
  );
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ email: user.email, selectedGroups: user.selectedGroups || [] });
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
  res.json({ status: 'ok', activeClients: activeClients.size });
});

// --- WhatsApp: one client per authenticated user ----------------------------
const activeClients = new Map(); // userId -> Client

function startClientForUser(userId) {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userId }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      // NOTE: do NOT add --single-process / --no-zygote here — they stop
      // whatsapp-web.js from ever emitting the QR on many systems.
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
      ],
    },
  });

  client._ready = false;
  client._lastQr = null;
  activeClients.set(userId, client);
  io.to(userId).emit('whatsapp_status', 'initializing');

  client.on('qr', (qr) => {
    client._lastQr = qr;
    io.to(userId).emit('whatsapp_qr', qr);
  });
  client.on('loading_screen', () => io.to(userId).emit('whatsapp_status', 'initializing'));
  client.on('authenticated', () => io.to(userId).emit('whatsapp_status', 'initializing'));
  client.on('auth_failure', () =>
    io.to(userId).emit('whatsapp_error', 'WhatsApp authentication failed — please retry.')
  );

  client.on('ready', async () => {
    client._ready = true;
    client._lastQr = null;
    io.to(userId).emit('whatsapp_status', 'connected');
    try {
      const chats = await client.getChats();
      const groups = chats
        .filter((c) => c.isGroup)
        .map((g) => ({ id: g.id._serialized, name: g.name }));
      io.to(userId).emit('whatsapp_groups', groups);
    } catch (err) {
      console.error('Error fetching chats:', err);
    }
  });

  client.on('disconnected', () => {
    client._ready = false;
    activeClients.delete(userId);
    io.to(userId).emit('whatsapp_status', 'disconnected');
  });

  client.on('message', async (msg) => {
    try {
      const user = await User.findById(userId).lean();
      if (!user || !Array.isArray(user.selectedGroups) || !user.selectedGroups.includes(msg.from)) {
        return;
      }

      let base64Image = null;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media && media.mimetype && media.mimetype.startsWith('image/')) {
            base64Image = media.data;
          }
        } catch (e) {
          console.error('Failed to download media:', e.message);
        }
      }

      const parsed = await parseDriveData(msg.body, base64Image);
      if (!parsed || (!parsed.company && !parsed.role)) return;

      const dedupKey = dedupKeyFor(parsed);
      try {
        const drive = await Drive.create({
          userId,
          company: parsed.company,
          role: parsed.role,
          ctc: parsed.ctc,
          eligibility: parsed.eligibility,
          deadline: parsed.deadline,
          applyLink: parsed.applyLink,
          dedupKey,
        });
        io.to(userId).emit('new_drive', {
          id: drive._id,
          company: drive.company,
          role: drive.role,
          ctc: drive.ctc,
          eligibility: drive.eligibility,
          deadline: drive.deadline,
          applyLink: drive.applyLink,
        });
      } catch (e) {
        if (e.code === 11000) {
          // duplicate (userId + dedupKey already exists) — skip silently
        } else {
          console.error('Insert drive error:', e.message);
        }
      }
    } catch (e) {
      console.error('Message handler error:', e);
    }
  });

  client.initialize().catch((e) => {
    console.error(`Failed to init WhatsApp client for ${userId}:`, e.message);
    activeClients.delete(userId);
    io.to(userId).emit('whatsapp_error', 'Could not start WhatsApp — tap retry.');
  });
}

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

  const existing = activeClients.get(userId);
  if (existing && existing._ready) {
    socket.emit('whatsapp_status', 'connected');
    existing
      .getChats()
      .then((chats) =>
        socket.emit(
          'whatsapp_groups',
          chats.filter((c) => c.isGroup).map((g) => ({ id: g.id._serialized, name: g.name }))
        )
      )
      .catch(() => {});
  } else if (existing) {
    // Client is still starting — resend the last QR if we already have one.
    socket.emit('whatsapp_status', 'initializing');
    if (existing._lastQr) socket.emit('whatsapp_qr', existing._lastQr);
  } else {
    startClientForUser(userId);
  }

  // Let the user force a fresh session / regenerate the QR.
  socket.on('restart_whatsapp', async () => {
    const c = activeClients.get(userId);
    if (c) {
      try { await c.destroy(); } catch {}
      activeClients.delete(userId);
    }
    startClientForUser(userId);
  });

  socket.on('disconnect', () => {});
});

// --- Boot -------------------------------------------------------------------
connectMongo(process.env.MONGODB_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to connect to MongoDB:', e.message);
    process.exit(1);
  });

module.exports = { app, server, io };
