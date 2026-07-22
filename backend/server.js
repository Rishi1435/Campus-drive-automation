const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const { Client, LocalAuth } = require('whatsapp-web.js');
const crypto = require('crypto');
const { parseDriveData } = require('./parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Database Initialization
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');

    db.run(`CREATE TABLE IF NOT EXISTS UserPreferences (
      tenantId TEXT PRIMARY KEY,
      selectedGroups TEXT
    )`, (err) => {
      if (err) {
        console.error('Error creating UserPreferences table', err.message);
      } else {
        console.log('UserPreferences table ready');
      }
    });

    db.run(`CREATE TABLE IF NOT EXISTS Drives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenantId TEXT,
      company TEXT,
      role TEXT,
      ctc TEXT,
      eligibility TEXT,
      deadline TEXT,
      applyLink TEXT,
      timestamp TEXT,
      dedupKey TEXT
    )`, (err) => {
      if (err) {
        console.error('Error creating Drives table', err.message);
      } else {
        console.log('Drives table ready');
      }
    });
  }
});

// WhatsApp Clients Map
const activeClients = new Map();

io.on('connection', (socket) => {
  console.log('User connected via Socket.io:', socket.id);

  socket.on('register_tenant', async (tenantId) => {
    if (!tenantId) return;

    socket.join(tenantId);
    console.log(`Tenant ${tenantId} registered on socket ${socket.id}`);

    if (activeClients.has(tenantId)) {
      console.log(`Client for ${tenantId} already exists.`);
      io.to(tenantId).emit('whatsapp_status', 'connected');
      return;
    }

    console.log(`Initializing new WhatsApp client for ${tenantId}`);

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: tenantId }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process'
        ]
      }
    });

    activeClients.set(tenantId, client);

    client.on('qr', (qr) => {
      console.log(`QR received for ${tenantId}`);
      io.to(tenantId).emit('whatsapp_qr', qr);
    });

    client.on('ready', async () => {
      console.log(`WhatsApp client ready for ${tenantId}`);
      io.to(tenantId).emit('whatsapp_status', 'connected');

      try {
        const chats = await client.getChats();
        const groups = chats
          .filter(chat => chat.isGroup)
          .map(group => ({ id: group.id._serialized, name: group.name }));
        io.to(tenantId).emit('whatsapp_groups', groups);
      } catch (err) {
        console.error('Error fetching chats:', err);
      }
    });

    client.on('message', async (msg) => {
      try {
        db.get('SELECT selectedGroups FROM UserPreferences WHERE tenantId = ?', [tenantId], async (err, row) => {
          if (err || !row || !row.selectedGroups) return;

          let selectedGroups = [];
          try {
            selectedGroups = JSON.parse(row.selectedGroups);
          } catch (e) {
            console.error('Error parsing selectedGroups JSON', e);
            return;
          }

          if (selectedGroups.includes(msg.from)) {
            console.log(`Processing message from ${msg.from} for tenant ${tenantId}`);

            let base64Image = null;
            if (msg.hasMedia) {
              try {
                const media = await msg.downloadMedia();
                if (media && media.mimetype && media.mimetype.startsWith('image/')) {
                  base64Image = media.data;
                }
              } catch (e) {
                console.error('Failed to download media:', e);
              }
            }

            const parsed = await parseDriveData(msg.body, base64Image);
            if (!parsed || (!parsed.company && !parsed.role)) return;

            const dedupString = `${parsed.company || ''}-${parsed.role || ''}-${parsed.deadline || ''}`.toLowerCase().replace(/\s+/g, '');
            const dedupKey = crypto.createHash('sha256').update(dedupString).digest('hex');

            db.get('SELECT id FROM Drives WHERE tenantId = ? AND dedupKey = ?', [tenantId, dedupKey], (err, row) => {
              if (err) return;
              if (!row) {
                const timestamp = new Date().toISOString();
                db.run(
                  `INSERT INTO Drives (tenantId, company, role, ctc, eligibility, deadline, applyLink, timestamp, dedupKey)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [tenantId, parsed.company, parsed.role, parsed.ctc, parsed.eligibility, parsed.deadline, parsed.applyLink, timestamp, dedupKey],
                  function(err) {
                    if (err) {
                      console.error('Error inserting drive:', err.message);
                      return;
                    }
                    const newDrive = {
                      id: this.lastID,
                      tenantId,
                      company: parsed.company,
                      role: parsed.role,
                      ctc: parsed.ctc,
                      eligibility: parsed.eligibility,
                      deadline: parsed.deadline,
                      applyLink: parsed.applyLink,
                      timestamp,
                      dedupKey
                    };
                    io.to(tenantId).emit('new_drive', newDrive);
                  }
                );
              } else {
                console.log('Duplicate drive detected, skipping.');
              }
            });
          }
        });
      } catch (e) {
        console.error('Error in message handler:', e);
      }
    });

    try {
        await client.initialize();
    } catch (e) {
        console.error(`Failed to init client for ${tenantId}:`, e);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// API Endpoints
app.get('/api/drives/:tenantId', (req, res) => {
  const { tenantId } = req.params;
  db.all('SELECT * FROM Drives WHERE tenantId = ? ORDER BY id DESC', [tenantId], (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.post('/api/groups/:tenantId', (req, res) => {
  const { tenantId } = req.params;
  const { selectedGroups } = req.body;

  if (!Array.isArray(selectedGroups)) {
    return res.status(400).json({ error: 'selectedGroups must be an array' });
  }

  const groupsStr = JSON.stringify(selectedGroups);

  db.run(
    `INSERT INTO UserPreferences (tenantId, selectedGroups) VALUES (?, ?)
     ON CONFLICT(tenantId) DO UPDATE SET selectedGroups = excluded.selectedGroups`,
    [tenantId, groupsStr],
    function (err) {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ success: true, message: 'Preferences saved successfully' });
    }
  );
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

module.exports = { app, server, io, db };
