const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { parseDriveData } = require('./parser');
const { saveToExcel } = require('./excelHandler');
require('dotenv').config();

// Keywords to filter relevant messages
const KEYWORDS = ['campus', 'drive', 'hiring', 'placement', 'ctc'];

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    // Generate and scan this code with your phone
    qrcode.generate(qr, { small: true });
    console.log('QR Code received, scan it please.');
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('message', async msg => {
    const text = msg.body.toLowerCase();

    // Check if the message contains any of the target keywords
    const isRelevant = KEYWORDS.some(keyword => text.includes(keyword));

    if (isRelevant) {
        console.log(`Relevant message received: ${msg.body.substring(0, 50)}...`);
        let base64Image = null;

        // If message has media (image flyer)
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                if (media.mimetype.startsWith('image/')) {
                    base64Image = media.data; // Base64 encoded string
                }
            } catch (error) {
                console.error('Failed to download media:', error);
            }
        }

        // Parse data via LLM
        const parsedData = await parseDriveData(msg.body, base64Image);

        if (parsedData) {
            console.log('Parsed data successfully:', parsedData);
            try {
                await saveToExcel(parsedData);
                console.log('Saved data to Excel.');
            } catch (error) {
                console.error('Failed to save to Excel:', error);
            }
        } else {
            console.log('Failed to parse relevant data from the message.');
        }
    }
});

client.initialize();
