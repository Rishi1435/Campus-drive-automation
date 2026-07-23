const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const { parseDriveData } = require('./parser');
const { encrypt, decrypt } = require('./secretbox');
const { mongoose, connectMongo, User, Drive } = require('./mongo');
require('dotenv').config();

// Keep the server alive through library-level failures (e.g. whatsapp-web.js's
// LocalAuth throwing EBUSY while Chromium still holds Windows file locks).
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
  res.json({ status: 'ok', activeClients: activeClients.size });
});

// --- WhatsApp: one client per authenticated user ----------------------------
const activeClients = new Map(); // userId -> Client

// Groups the UI can whitelist = those from getChats() PLUS any group we've seen
// a message from (a fallback for when getChats is broken by a WhatsApp update).
function mergedGroups(client) {
  const map = new Map();
  for (const g of client._groups || []) map.set(g.id, g.name);
  if (client._discovered) for (const [id, name] of client._discovered) if (!map.has(id)) map.set(id, name);
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

// Read groups straight from WhatsApp's in-page store, tolerating individual bad
// chats. getChats() serializes every chat at once, so one broken chat makes the
// whole call throw ("r"); this per-chat loop survives that.
async function groupsFromStore(client) {
  return client.pupPage.evaluate(() => {
    const out = [];
    try {
      const S = window.Store;
      let arr = [];
      if (S && S.Chat) {
        if (typeof S.Chat.getModelsArray === 'function') arr = S.Chat.getModelsArray();
        else if (Array.isArray(S.Chat._models)) arr = S.Chat._models;
        else if (Array.isArray(S.Chat.models)) arr = S.Chat.models;
      }
      for (const c of arr) {
        try {
          const isGroup = c.isGroup !== undefined ? c.isGroup : c.id && c.id.server === 'g.us';
          const id = c.id && c.id._serialized;
          if (isGroup && id) {
            out.push({ id, name: c.formattedTitle || c.name || c.subject || (c.id && c.id.user) || 'Group' });
          }
        } catch (e) { /* skip this chat */ }
      }
    } catch (e) { /* Store not ready */ }
    return out;
  });
}

// Resolve a single group's display name from the in-page store (works even when
// getChat() is broken by a WhatsApp update).
async function groupNameFromStore(client, groupId) {
  try {
    return await client.pupPage.evaluate((id) => {
      try {
        const S = window.Store || {};
        const chat = S.Chat && S.Chat.get ? S.Chat.get(id) : null;
        if (chat) {
          const n = chat.formattedTitle || chat.name || chat.subject;
          if (n) return n;
          if (chat.groupMetadata && chat.groupMetadata.subject) return chat.groupMetadata.subject;
        }
        const gm = S.GroupMetadata && S.GroupMetadata.get ? S.GroupMetadata.get(id) : null;
        if (gm && gm.subject) return gm.subject;
        const contact = S.Contact && S.Contact.get ? S.Contact.get(id) : null;
        if (contact) return contact.name || contact.formattedName || contact.pushname || null;
        return null;
      } catch (e) {
        return null;
      }
    }, groupId);
  } catch (e) {
    return null;
  }
}

// Best-effort group loading: try the normal API, then the resilient store read,
// then whatever we've discovered from messages. Never throws.
async function loadGroups(client, userId) {
  try {
    const chats = await client.getChats();
    client._groups = chats.filter((c) => c.isGroup).map((g) => ({ id: g.id._serialized, name: g.name }));
    io.to(userId).emit('whatsapp_groups', mergedGroups(client));
    return;
  } catch (e) {
    // getChats broken by a WhatsApp update — fall through to the store reader.
  }
  try {
    const groups = await groupsFromStore(client);
    if (groups && groups.length) {
      client._groups = groups;
      console.log(`Loaded ${groups.length} groups via store fallback.`);
    }
  } catch (e) {
    console.error('Group store fallback failed:', e.message);
  }
  io.to(userId).emit('whatsapp_groups', mergedGroups(client));
}

function startClientForUser(userId) {
  const clientOptions = {
    // RemoteAuth stores the session in MongoDB, so the WhatsApp login SURVIVES
    // restarts/redeploys (Render's disk is ephemeral) and stays linked until the
    // user explicitly disconnects it.
    authStrategy: new RemoteAuth({
      clientId: userId,
      store: new MongoStore({ mongoose }),
      // Persist the session to Mongo sooner (min allowed is 60s) so a restart in
      // the first few minutes after linking doesn't lose it and force a re-scan.
      backupSyncIntervalMs: 60000,
    }),
    // If WhatsApp reports the web session was taken over (phone re-links, another
    // tab, a transient conflict), reclaim it instead of dropping to a new QR —
    // this is the usual cause of "scanned, connecting… then QR shows again".
    takeoverOnConflict: true,
    takeoverTimeoutMs: 60000,
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
        // Trim Chromium's memory footprint — on Render's free 512 MB instance an
        // OOM kill right after login also shows up as a scan → QR-again loop.
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--mute-audio',
      ],
    },
  };

  // Optional: pin a specific WhatsApp Web build if a WhatsApp update breaks
  // getChats. Set WWEB_VERSION to a filename from
  // https://github.com/wppconnect-team/wa-version/tree/main/html (without .html),
  // e.g. WWEB_VERSION=2.3000.1023204808. Left unset, the default (working) build is used.
  if (process.env.WWEB_VERSION) {
    clientOptions.webVersionCache = {
      type: 'remote',
      remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${process.env.WWEB_VERSION}.html`,
    };
  }

  const client = new Client(clientOptions);

  client._ready = false;
  client._lastQr = null;
  client._groups = [];
  client._discovered = new Map(); // groupId -> name, learned from incoming messages
  client._initializing = true;
  client._failed = false;
  activeClients.set(userId, client);
  io.to(userId).emit('whatsapp_status', 'initializing');

  client.on('qr', (qr) => {
    client._lastQr = qr;
    io.to(userId).emit('whatsapp_qr', qr);
  });
  client.on('loading_screen', (percent) =>
    io.to(userId).emit('whatsapp_status', 'initializing')
  );
  client.on('authenticated', () => {
    console.log(`WhatsApp authenticated for ${userId} — saving session…`);
    io.to(userId).emit('whatsapp_status', 'initializing');
  });
  // RemoteAuth persisted the session to Mongo — from here a restart won't re-QR.
  client.on('remote_session_saved', () =>
    console.log(`WhatsApp session persisted to Mongo for ${userId}.`)
  );
  client.on('auth_failure', (m) => {
    console.error(`WhatsApp auth_failure for ${userId}: ${m}`);
    io.to(userId).emit('whatsapp_error', 'WhatsApp authentication failed — please retry.');
  });

  client.on('ready', () => {
    client._ready = true;
    client._initializing = false;
    client._lastQr = null;
    client._reconnects = 0; // healthy connection — reset the backoff counter
    console.log(`WhatsApp READY for ${userId}.`);
    io.to(userId).emit('whatsapp_status', 'connected');
    loadGroups(client, userId);
  });

  client.on('disconnected', (reason) => {
    console.warn(`WhatsApp disconnected for ${userId}. Reason: ${reason}`);
    client._ready = false;
    activeClients.delete(userId);
    io.to(userId).emit('whatsapp_status', 'disconnected');
    // Auto-reconnect on unexpected drops (keeps WhatsApp "always on"); but NOT
    // when the user explicitly logged out or WhatsApp ended the session.
    if (!client._intentionalLogout && reason !== 'LOGOUT') {
      // Back off on repeated drops so we don't strobe the user between
      // "connecting" and a fresh QR; give up after several tries.
      const attempts = (client._reconnects || 0) + 1;
      if (attempts > 5) {
        console.error(`WhatsApp gave up reconnecting for ${userId} after ${attempts} tries.`);
        io.to(userId).emit('whatsapp_status', 'error');
        io.to(userId).emit(
          'whatsapp_error',
          'WhatsApp keeps dropping right after connecting. Tap Disconnect to clear the session, then re-scan.'
        );
        return;
      }
      const delay = Math.min(30000, 5000 * attempts);
      setTimeout(() => {
        if (!activeClients.has(userId)) {
          const next = startClientForUser(userId);
          if (next) next._reconnects = attempts;
        }
      }, delay);
    }
  });

  // Add a group to the selectable list (fallback for when getChats is broken).
  // Resolves the real group NAME from the in-page store, falling back to getChat.
  const discover = async (groupId, msg) => {
    if (!groupId || !groupId.endsWith('@g.us')) return;
    const existingName = client._discovered.get(groupId);
    if (existingName && existingName !== groupId) return; // already have a real name

    let name = await groupNameFromStore(client, groupId);
    if (!name && msg) {
      try {
        const chat = await msg.getChat();
        if (chat && chat.name) name = chat.name;
      } catch {}
    }
    client._discovered.set(groupId, name || groupId);
    io.to(userId).emit('whatsapp_groups', mergedGroups(client));
  };

  // A message the user SENDS in a group makes that group instantly selectable.
  // This is discovery ONLY — your own messages are never parsed as drives.
  client.on('message_create', (msg) => {
    if (msg.fromMe && msg.to) discover(msg.to, msg);
  });

  client.on('message', async (msg) => {
    try {
      // Learn about any group we hear from, so it's selectable even if getChats broke.
      await discover(msg.from, msg);

      // Only parse INCOMING messages from whitelisted groups — never our own.
      if (msg.fromMe) return;

      const user = await User.findById(userId).lean();
      if (!user || !Array.isArray(user.selectedGroups) || !user.selectedGroups.includes(msg.from)) {
        return;
      }

      // Only capture placement/internship-related messages. Text must mention a
      // relevant keyword; image messages (flyers) pass through to the vision model.
      const isPlacement =
        /placement|intern|hiring|recruit|\bctc\b|stipend|\bdrive\b|\bjob\b|opening|off.?campus|on.?campus|walk.?in|eligibil|\bapply\b|opportunit|vacanc|\blpa\b|\bhr\b|hiring|shortlist/i.test(
          msg.body || ''
        );
      if (!msg.hasMedia && !isPlacement) return;

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

      const parsed = await parseDriveData(msg.body, base64Image, decrypt(user.nvidiaApiKey));
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
          applied: false,
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

  client.initialize().catch(async (e) => {
    console.error(`Failed to init WhatsApp client for ${userId}:`, e.message);
    client._initializing = false;
    client._failed = true;
    client._error =
      'Could not start WhatsApp. Tap retry — if it keeps failing, stop the server and delete the backend/.wwebjs_auth session folder, then re-scan.';
    // Release Chromium so a retry isn't blocked by "browser already running".
    try { await client.destroy(); } catch {}
    io.to(userId).emit('whatsapp_status', 'error');
    io.to(userId).emit('whatsapp_error', client._error);
  });

  return client;
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
    socket.emit('whatsapp_groups', mergedGroups(existing));
  } else if (existing && existing._failed) {
    // Don't auto-relaunch a failed client (avoids the launch spam) — wait for retry.
    socket.emit('whatsapp_status', 'error');
    socket.emit('whatsapp_error', existing._error || 'WhatsApp failed to start — tap retry.');
  } else if (existing) {
    // Client is still starting — resend the last QR if we already have one.
    socket.emit('whatsapp_status', 'initializing');
    if (existing._lastQr) socket.emit('whatsapp_qr', existing._lastQr);
  } else {
    startClientForUser(userId);
  }

  // Manual "Refresh groups" — re-attempt getChats on demand.
  socket.on('refresh_groups', () => {
    const c = activeClients.get(userId);
    if (c && c._ready) loadGroups(c, userId);
  });

  // Explicitly unlink WhatsApp (removes the stored session so it won't auto-reconnect).
  socket.on('logout_whatsapp', async () => {
    const c = activeClients.get(userId);
    if (c) {
      c._intentionalLogout = true; // prevent the auto-reconnect below
      try { await c.logout(); } catch {}
      try { await c.destroy(); } catch {}
      activeClients.delete(userId);
    }
    // Purge the persisted RemoteAuth session from Mongo even if no live client
    // exists (or logout failed) — otherwise a corrupt saved session keeps getting
    // restored and re-fails, trapping the user in a scan → QR-again loop.
    try {
      const store = new MongoStore({ mongoose });
      const session = `RemoteAuth-${userId}`;
      if (await store.sessionExists({ session })) await store.delete({ session });
    } catch (e) {
      console.error('Failed to purge stored WhatsApp session:', e.message);
    }
    io.to(userId).emit('whatsapp_status', 'disconnected');
  });

  // Let the user force a fresh session / regenerate the QR.
  socket.on('restart_whatsapp', async () => {
    const c = activeClients.get(userId);
    if (c && c._initializing) return; // an init is already in flight — don't stampede
    if (c) {
      try { await c.destroy(); } catch {}
      activeClients.delete(userId);
    }
    startClientForUser(userId);
  });

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

// On boot, resume WhatsApp for users who have configured groups, so capture
// continues even when no dashboard is open (their stored session auto-restores).
async function resumeSessions() {
  try {
    const users = await User.find({ selectedGroups: { $exists: true, $ne: [] } })
      .select('_id')
      .lean();
    if (!users.length) return;
    console.log(`Resuming WhatsApp for ${users.length} user(s)…`);
    for (const u of users) {
      if (!activeClients.has(u._id.toString())) startClientForUser(u._id.toString());
      await new Promise((r) => setTimeout(r, 8000)); // stagger to spread RAM/CPU
    }
  } catch (e) {
    console.error('resumeSessions error:', e.message);
  }
}

// --- Boot -------------------------------------------------------------------
connectMongo(process.env.MONGODB_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    startKeepAlive();
    resumeSessions();
  })
  .catch((e) => {
    console.error('Failed to connect to MongoDB:', e.message);
    process.exit(1);
  });

module.exports = { app, server, io };
