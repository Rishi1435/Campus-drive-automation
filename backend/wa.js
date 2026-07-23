// WhatsApp engine — Baileys (WebSocket protocol, NO browser/Chromium).
//
// This replaces whatsapp-web.js + Puppeteer. A Baileys socket is a plain Node
// WebSocket client using ~60-80 MB, so it fits a free 512 MB host and starts in
// seconds — which is what makes free 24/7 capture actually viable. The auth
// session is persisted in MongoDB, so the login survives restarts/redeploys.
//
// It exposes the same socket.io contract the frontend already speaks, so the UI
// is unchanged: emits whatsapp_qr / whatsapp_status / whatsapp_groups /
// whatsapp_error / new_drive, and responds to start/restart/logout/refresh.

const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  initAuthCreds,
  BufferJSON,
  proto,
} = require('@whiskeysockets/baileys');

const LOG = pino({ level: 'silent' }); // Baileys is chatty — keep it quiet.

// Only capture placement/internship-related text. Image flyers bypass this and
// go straight to the vision model. (Same rule as the previous engine.)
const PLACEMENT_RE =
  /placement|intern|hiring|recruit|\bctc\b|stipend|\bdrive\b|\bjob\b|opening|off.?campus|on.?campus|walk.?in|eligibil|\bapply\b|opportunit|vacanc|\blpa\b|\bhr\b|hiring|shortlist/i;

// Unwrap ephemeral / view-once / caption wrappers to reach the real content.
function unwrap(message) {
  if (!message) return message;
  if (message.ephemeralMessage) return unwrap(message.ephemeralMessage.message);
  if (message.viewOnceMessage) return unwrap(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2) return unwrap(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension)
    return unwrap(message.viewOnceMessageV2Extension.message);
  if (message.documentWithCaptionMessage)
    return unwrap(message.documentWithCaptionMessage.message);
  return message;
}

function extractText(content) {
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  );
}

function createWhatsApp({ io, mongoose, User, Drive, parseDriveData, decrypt, dedupKeyFor, maxUsers = 5 }) {
  const clients = new Map(); // userId -> state object

  // --- MongoDB-backed Baileys auth state -----------------------------------
  // Stores creds + signal keys as documents keyed by (userId, id), using
  // Baileys' BufferJSON so Buffers survive the round-trip. This is what keeps
  // the login alive across restarts on an ephemeral host.
  async function mongoAuthState(userId) {
    const coll = mongoose.connection.collection('wa_auth');

    const read = async (id) => {
      const doc = await coll.findOne({ userId, id });
      return doc ? JSON.parse(doc.data, BufferJSON.reviver) : null;
    };
    const write = async (id, value) => {
      const data = JSON.stringify(value, BufferJSON.replacer);
      await coll.updateOne({ userId, id }, { $set: { userId, id, data } }, { upsert: true });
    };
    const del = async (id) => {
      await coll.deleteOne({ userId, id });
    };

    const creds = (await read('creds')) || initAuthCreds();

    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const result = {};
            await Promise.all(
              ids.map(async (id) => {
                let value = await read(`${type}-${id}`);
                if (type === 'app-state-sync-key' && value) {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value);
                }
                result[id] = value;
              })
            );
            return result;
          },
          set: async (data) => {
            const tasks = [];
            for (const type in data) {
              for (const id in data[type]) {
                const value = data[type][id];
                const key = `${type}-${id}`;
                tasks.push(value ? write(key, value) : del(key));
              }
            }
            await Promise.all(tasks);
          },
        },
      },
      saveCreds: () => write('creds', creds),
      clear: () => coll.deleteMany({ userId }),
    };
  }

  // --- Group list helpers ---------------------------------------------------
  function groupsPayload(st) {
    const map = new Map();
    for (const [id, name] of st.groups) map.set(id, name);
    for (const [id, name] of st.discovered) if (!map.has(id)) map.set(id, name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }

  function emitGroups(userId, st) {
    io.to(userId).emit('whatsapp_groups', groupsPayload(st));
  }

  async function loadGroups(userId, st) {
    try {
      const all = await st.sock.groupFetchAllParticipating();
      st.groups = new Map(
        Object.entries(all).map(([jid, meta]) => [jid, meta.subject || jid])
      );
      console.log(`Loaded ${st.groups.size} WhatsApp groups for ${userId}.`);
    } catch (e) {
      console.error('groupFetchAllParticipating failed:', e.message);
    }
    emitGroups(userId, st);
  }

  // --- Incoming message handling -------------------------------------------
  async function handleMessage(userId, st, msg) {
    const jid = msg.key?.remoteJid;
    if (!jid || !jid.endsWith('@g.us')) return; // groups only, never personal chats

    // Learn the group's name so it's selectable in the UI, even before a full sync.
    if (!st.groups.has(jid) && !st.discovered.has(jid)) {
      let name = jid;
      try {
        const meta = await st.sock.groupMetadata(jid);
        if (meta?.subject) name = meta.subject;
      } catch {}
      st.discovered.set(jid, name);
      emitGroups(userId, st);
    }

    if (msg.key.fromMe) return; // never parse the user's own messages

    const user = await User.findById(userId).lean();
    if (!user || !Array.isArray(user.selectedGroups) || !user.selectedGroups.includes(jid)) {
      return; // not a whitelisted group
    }

    const content = unwrap(msg.message);
    const text = extractText(content);
    const imageMessage = content?.imageMessage;
    if (!imageMessage && !PLACEMENT_RE.test(text)) return;

    let base64Image = null;
    if (imageMessage) {
      try {
        const buffer = await downloadMediaMessage(
          { key: msg.key, message: content },
          'buffer',
          {},
          { logger: LOG, reuploadRequest: st.sock.updateMediaMessage }
        );
        base64Image = buffer.toString('base64');
      } catch (e) {
        console.error('Failed to download media:', e.message);
      }
    }

    const parsed = await parseDriveData(text, base64Image, decrypt(user.nvidiaApiKey));
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
      if (e.code !== 11000) console.error('Insert drive error:', e.message); // 11000 = duplicate, skip
    }
  }

  // --- Start / connect a user's WhatsApp socket ----------------------------
  async function start(userId, reconnects = 0) {
    const existing = clients.get(userId);
    if (existing && (existing.starting || existing.ready)) return existing;

    // Capacity guard: cap the number of DISTINCT live WhatsApp links so a small
    // free instance can't be overwhelmed. Existing users (reconnects) never count
    // against it — only a brand-new user beyond the limit is turned away.
    if (!existing && maxUsers > 0 && clients.size >= maxUsers) {
      console.warn(`Capacity reached (${clients.size}/${maxUsers}) — refusing new WhatsApp link for ${userId}.`);
      io.to(userId).emit('whatsapp_status', 'error');
      io.to(userId).emit(
        'whatsapp_error',
        `Server is at capacity (${maxUsers} people linked). Please try again later.`
      );
      return null;
    }

    const st = {
      starting: true,
      ready: false,
      failed: false,
      dead: false,
      lastQr: null,
      error: null,
      reconnects,
      groups: new Map(),
      discovered: new Map(),
      sock: null,
    };
    clients.set(userId, st);
    io.to(userId).emit('whatsapp_status', 'initializing');

    try {
      const auth = await mongoAuthState(userId);
      st.clearAuth = auth.clear;

      let version;
      try {
        version = (await fetchLatestBaileysVersion()).version;
      } catch {
        /* no network for version check — Baileys uses its bundled default */
      }

      const sock = makeWASocket({
        version,
        logger: LOG,
        printQRInTerminal: false,
        auth: {
          creds: auth.state.creds,
          keys: makeCacheableSignalKeyStore(auth.state.keys, LOG),
        },
        browser: Browsers.ubuntu('Chrome'), // how it shows in "Linked Devices"
        markOnlineOnConnect: false, // don't steal notifications from the phone
        syncFullHistory: false,
      });
      st.sock = sock;
      st.starting = false;

      sock.ev.on('creds.update', auth.saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // Alive and waiting for a scan — surface the QR and reset the crash
          // counter so waiting to scan can't trip the give-up cap.
          st.lastQr = qr;
          st.reconnects = 0;
          io.to(userId).emit('whatsapp_qr', qr);
        }

        if (connection === 'connecting') {
          io.to(userId).emit('whatsapp_status', 'initializing');
        }

        if (connection === 'open') {
          st.ready = true;
          st.lastQr = null;
          st.reconnects = 0;
          console.log(`WhatsApp READY for ${userId}.`);
          io.to(userId).emit('whatsapp_status', 'connected');
          loadGroups(userId, st);
        }

        if (connection === 'close') {
          st.ready = false;
          if (st.dead) return; // intentional teardown (logout/restart)

          const code = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
          console.warn(`WhatsApp closed for ${userId}. code=${code} loggedOut=${loggedOut}`);

          if (loggedOut) {
            // Session is dead on the phone — clear it so we start clean next time.
            clients.delete(userId);
            try { await st.clearAuth(); } catch {}
            io.to(userId).emit('whatsapp_status', 'disconnected');
            io.to(userId).emit(
              'whatsapp_error',
              'WhatsApp was unlinked from your phone. Scan again to reconnect.'
            );
            return;
          }

          const attempts = (st.reconnects || 0) + 1;
          if (attempts > 8) {
            clients.delete(userId);
            io.to(userId).emit('whatsapp_status', 'error');
            io.to(userId).emit(
              'whatsapp_error',
              'WhatsApp keeps dropping. Tap Retry, or Disconnect and re-scan.'
            );
            return;
          }

          // restartRequired (515) is the NORMAL step right after a first scan —
          // reconnect immediately; back off on genuine drops.
          st.dead = true; // retire this state; a fresh one takes over
          clients.delete(userId);
          const delay = code === DisconnectReason.restartRequired ? 300 : Math.min(20000, 3000 * attempts);
          setTimeout(() => start(userId, attempts), delay);
        }
      });

      // Keep group names fresh as WhatsApp pushes updates.
      sock.ev.on('groups.upsert', (grps) => {
        for (const g of grps) st.groups.set(g.id, g.subject || g.id);
        emitGroups(userId, st);
      });
      sock.ev.on('groups.update', (updates) => {
        let changed = false;
        for (const g of updates) if (g.id && g.subject) { st.groups.set(g.id, g.subject); changed = true; }
        if (changed) emitGroups(userId, st);
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; // realtime only, skip history backfill
        for (const msg of messages || []) {
          if (!msg.message) continue;
          handleMessage(userId, st, msg).catch((e) =>
            console.error('Message handler error:', e.message)
          );
        }
      });
    } catch (e) {
      console.error(`Failed to start WhatsApp for ${userId}:`, e.message);
      st.starting = false;
      st.failed = true;
      st.error = 'Could not start WhatsApp. Tap Retry.';
      io.to(userId).emit('whatsapp_status', 'error');
      io.to(userId).emit('whatsapp_error', st.error);
    }

    return st;
  }

  // --- Public operations ----------------------------------------------------
  function getState(userId) {
    return clients.get(userId);
  }

  function emitGroupsTo(socket, userId) {
    const st = clients.get(userId);
    if (st) socket.emit('whatsapp_groups', groupsPayload(st));
  }

  // Force a fresh connection (regenerate QR / recover). Keeps stored creds, so
  // if the link is still valid it reconnects without a re-scan.
  async function restart(userId) {
    const st = clients.get(userId);
    if (st) {
      st.dead = true;
      try { st.sock?.end(undefined); } catch {}
      clients.delete(userId);
    }
    return start(userId);
  }

  // Unlink WhatsApp: log out on the phone AND wipe the stored session so it
  // won't auto-reconnect and can't be resurrected from a stale session.
  async function logout(userId) {
    const st = clients.get(userId);
    if (st) {
      st.dead = true;
      try { await st.sock?.logout(); } catch {}
      try { st.sock?.end(undefined); } catch {}
      clients.delete(userId);
    }
    try {
      await mongoose.connection.collection('wa_auth').deleteMany({ userId });
    } catch (e) {
      console.error('Failed to purge stored WhatsApp session:', e.message);
    }
    io.to(userId).emit('whatsapp_status', 'disconnected');
  }

  function refreshGroups(userId) {
    const st = clients.get(userId);
    if (st && st.ready) loadGroups(userId, st);
  }

  // Start a socket only if one isn't already running (used on dashboard open).
  function ensureFor(userId) {
    if (!clients.has(userId)) start(userId);
  }

  function count() {
    return clients.size;
  }

  // A tiny snapshot of live WhatsApp links for the health/admin endpoint.
  function stats() {
    let connected = 0;
    let connecting = 0;
    let failed = 0;
    for (const st of clients.values()) {
      if (st.ready) connected++;
      else if (st.failed) failed++;
      else connecting++;
    }
    return { connected, connecting, failed, total: clients.size, capacity: maxUsers };
  }

  // On boot, reconnect users who have configured groups so capture continues
  // even with no dashboard open. Their stored session restores silently.
  async function resumeSessions() {
    try {
      const users = await User.find({ selectedGroups: { $exists: true, $ne: [] } })
        .select('_id')
        .lean();
      if (!users.length) return;
      console.log(`Resuming WhatsApp for ${users.length} user(s)…`);
      for (const u of users) {
        const userId = u._id.toString();
        // Only bother if a saved session exists — otherwise there's nothing to
        // resume (a QR-only start with no dashboard open is pointless).
        const hasSession = await mongoose.connection
          .collection('wa_auth')
          .findOne({ userId, id: 'creds' });
        if (hasSession && !clients.has(userId)) start(userId);
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      console.error('resumeSessions error:', e.message);
    }
  }

  return {
    start,
    restart,
    logout,
    refreshGroups,
    ensureFor,
    resumeSessions,
    getState,
    emitGroupsTo,
    count,
    stats,
  };
}

module.exports = { createWhatsApp };
