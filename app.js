// ✅ Multi-Number WhatsApp Auto Sender (Baileys)
const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const qrcode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');

app.use(express.json());
app.use(express.static('public'));

if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

let globalSocket = null;
let qrData = null;
let isReady = false;
let isLooping = false;
let currentLoop = null;

async function startSocket() {
  if (globalSocket) return;
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Multi Sender', 'Chrome', '1.0'],
    getMessage: async () => ({ conversation: "hello" })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;
    if (qr) {
      qrData = qr;
      isReady = false;
    }
    if (connection === 'open') {
      isReady = true;
      qrData = null;
      console.log('✅ WhatsApp Connected!');
    }
    if (connection === 'close') {
      isReady = false;
      qrData = null;
      globalSocket = null;
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        setTimeout(startSocket, 3000);
      }
    }
  });

  globalSocket = sock;
}

startSocket();

// Get QR API
app.get('/api/qr', async (req, res) => {
  if (isReady) return res.json({ message: '✅ Already authenticated!' });
  if (!qrData) return res.json({ message: '⏳ QR code not ready yet.' });
  const qrImage = await qrcode.toDataURL(qrData);
  res.json({ qr: qrImage });
});

// Start Sending
app.post('/api/start', (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const { receiver, delay, name } = fields;
    const delaySec = parseInt(delay) || 2;

    if (!receiver || !name || !files.file) {
      return res.status(400).json({ error: '❌ All fields required' });
    }

    const receivers = receiver
      .split(',')
      .map(n => n.trim())
      .filter(n => /^\d{10,15}$/.test(n));

    if (receivers.length === 0) {
      return res.status(400).json({ error: '❌ No valid numbers provided' });
    }

    const sock = globalSocket;
    if (!sock || !isReady) return res.status(400).json({ error: '❌ WhatsApp not connected' });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = file.filepath || file.path;
    const lines = fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return res.status(400).json({ error: '❌ File is empty.' });

    isLooping = true;

    const sendMessages = async () => {
      while (isLooping) {
        for (const jidNum of receivers) {
          const jid = jidNum + '@s.whatsapp.net';
          for (const line of lines) {
            if (!isLooping) break;
            const finalMessage = `${name} ${line}`;
            await sock.sendMessage(jid, { text: finalMessage });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }
        }
      }
    };

    currentLoop = sendMessages();
    return res.json({ message: `✅ Started sending messages to ${receivers.length} number(s)` });
  });
});

// Stop Sending
app.post('/api/stop', (req, res) => {
  isLooping = false;
  currentLoop = null;
  res
.json({ message: '🛑 Message sending stopped.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

                              
