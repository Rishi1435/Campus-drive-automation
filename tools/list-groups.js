// One-off helper: prints your WhatsApp groups and their IDs so you can fill in
// WA_ALLOWED_CHATS in .env. Run:  node tools/list-groups.js
// Scan the QR the first time; it reuses the saved session afterward.
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('Scan the QR above with WhatsApp > Linked Devices.');
});

client.on('ready', async () => {
  const chats = await client.getChats();
  const groups = chats.filter((c) => c.isGroup);
  console.log('\n=== Your WhatsApp GROUPS (copy the IDs you want into WA_ALLOWED_CHATS) ===\n');
  for (const g of groups) {
    console.log(`${g.name}\n  ID: ${g.id._serialized}\n`);
  }
  console.log(`Total groups: ${groups.length}`);
  console.log('\nExample .env line:');
  console.log(
    'WA_ALLOWED_CHATS=' + groups.slice(0, 2).map((g) => g.id._serialized).join(',')
  );
  process.exit(0);
});

client.initialize();
