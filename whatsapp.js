const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const { mongoose, connect } = require('./db');

// Choose where the WhatsApp session is stored. On cloud hosts with ephemeral
// disks (Render/Koyeb) we use RemoteAuth -> MongoDB so the login survives
// restarts and you don't re-scan the QR. Locally we use LocalAuth (disk).
async function buildAuthStrategy() {
  if (config.mongoUri) {
    await connect();
    const { MongoStore } = require('wwebjs-mongo');
    const store = new MongoStore({ mongoose });
    console.log('WhatsApp session store: MongoDB (RemoteAuth).');
    return new RemoteAuth({
      store,
      clientId: 'campus-drive',
      backupSyncIntervalMs: 300000, // sync session to DB every 5 min
    });
  }
  console.log('WhatsApp session store: local disk (LocalAuth).');
  return new LocalAuth();
}

async function buildClient() {
  return new Client({
    authStrategy: await buildAuthStrategy(),
    puppeteer: {
      headless: true,
      // Required when running as root inside a container / on a headless server.
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  });
}

function isRelevant(text) {
  if (!config.requireKeywords) return true;
  const lower = text.toLowerCase();
  return config.keywords.some((k) => lower.includes(k.toLowerCase()));
}

// onDrive receives { text, base64Image, source } for each placement message.
// Personal chats are NEVER passed here: we only look at whitelisted group IDs,
// so private conversations are never downloaded or sent to the LLM.
async function startWhatsapp(onDrive) {
  const client = await buildClient();
  // Allow whitelisting by either the chat ID (…@g.us) or the group NAME
  // (case-insensitive), so you can just list the group names you see in the app.
  const allowed = new Set(config.whatsappAllowedChats.map((s) => s.toLowerCase()));

  const isAllowedChat = async (msg) => {
    if (allowed.has(msg.from.toLowerCase())) return true;
    try {
      const chat = await msg.getChat();
      return chat && chat.name && allowed.has(chat.name.toLowerCase());
    } catch {
      return false;
    }
  };

  client.on('remote_session_saved', () => console.log('WhatsApp session backed up to MongoDB.'));

  client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR above with WhatsApp > Linked Devices.');
  });

  client.on('ready', () => {
    console.log('WhatsApp client ready.');
    if (allowed.size === 0) {
      console.warn(
        'WARNING: WA_ALLOWED_CHATS is empty — NO messages will be processed. ' +
          'Run `node tools/list-groups.js` to get your placement group IDs.'
      );
    } else {
      console.log(`Listening to ${allowed.size} whitelisted chat(s).`);
    }
  });

  client.on('message', async (msg) => {
    // Whitelist gate: ignore anything not from an approved placement chat.
    if (!(await isAllowedChat(msg))) return;
    if (!isRelevant(msg.body)) return;

    console.log(`[WhatsApp] Placement message in ${msg.from}: ${msg.body.slice(0, 60)}...`);

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

    try {
      await onDrive({ text: msg.body, base64Image, source: `WhatsApp:${msg.from}` });
    } catch (e) {
      console.error('Handler error:', e.message);
    }
  });

  client.on('disconnected', (reason) => {
    console.error('WhatsApp disconnected:', reason, '— restarting client.');
    client.initialize();
  });

  client.initialize();
  return client;
}

module.exports = { startWhatsapp };
