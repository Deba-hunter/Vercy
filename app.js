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
  console.log("⚙️ Starting WhatsApp socket...");
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Made by Aadi', 'Chrome', '1.0'],
    getMessage: async () => ({ conversation: "hello" }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;
    if (qr) {
      qrData = qr;
      isReady = false;
      console.log('🟡 QR Code ready, waiting for scan...');
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
      console.log('❌ WhatsApp Disconnected');
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        console.log('🔁 Reconnecting in 3s...');
        setTimeout(startSocket, 3000);
      }
    }
  });

  globalSocket = sock;
}

startSocket();

// QR API
app.get('/api/qr', async (req, res) => {
  if (isReady) return res.json({ message: '✅ Already authenticated!' });
  if (!qrData) return res.json({ message: '⏳ QR code not ready yet.' });
  const qrImage = await qrcode.toDataURL(qrData);
  res.json({ qr: qrImage });
});

// START API
app.post('/api/start', (req, res) => {
  console.log("📩 /api/start called");

  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("❌ Form error:", err);
      return res.status(500).json({ error: 'Form parse error' });
    }

    const { receiver, delay, name } = fields;
    const delaySec = parseInt(delay) || 2;

    if (!receiver || !/^\d{10,15}$/.test(receiver)) {
      return res.status(400).json({ error: '❌ Invalid WhatsApp number' });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: '❌ Name is required' });
    }

    if (!files.file) return res.status(400).json({ error: '❌ File required' });

    const sock = globalSocket;
    if (!sock || !isReady) {
      console.log("❌ WhatsApp not connected");
      return res.status(400).json({ error: '❌ WhatsApp not connected' });
    }

    const jid = receiver + '@s.whatsapp.net';
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = file.filepath || file.path;

    const lines = fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return res.status(400).json({ error: '❌ File is empty.' });

    isLooping = true;

    console.log(`🚀 Starting to send messages to ${receiver}`);

    const sendMessages = async () => {
      while (isLooping) {
        for (const line of lines) {
          if (!isLooping) break;
          const finalMessage = `${name} ${line}`;
          console.log("📤 Sending:", finalMessage);
          await sock.sendMessage(jid, { text: finalMessage });
          await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
        }
      }
    };

    currentLoop = sendMessages();
    return res.json({ message: `✅ Started sending messages to ${receiver}` });
  });
});

// STOP API
app.post('/api/stop', (req, res) => {
  isLooping = false;
  currentLoop = null;
  console.log("🛑 Message sending stopped");
  res.json({ message: '🛑 Message sending stopped.' });
});

// Server start
app.listen(PORT, () => {
  console.log(`🌐 Server running on http://localhost:${PORT}`);
});
