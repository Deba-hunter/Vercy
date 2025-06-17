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

app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

let sock, qrData = null, isReady = false, isLooping = false;

async function startSocket() {
  if (sock) return;
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['RenderSender', 'Chrome', '1.0']
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr) qrData = qr;
    if (connection === 'open') {
      isReady = true;
      qrData = null;
      console.log('✅ WhatsApp Connected');
    }
    if (connection === 'close') {
      isReady = false;
      qrData = null;
      sock = null;
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        setTimeout(startSocket, 3000);
      }
    }
  });
}

startSocket();

app.get('/api/qr', async (req, res) => {
  if (isReady) return res.json({ message: '✅ Already connected!' });
  if (!qrData) return res.json({ message: '⏳ QR not ready...' });
  const qrImage = await qrcode.toDataURL(qrData);
  res.json({ qr: qrImage });
});

app.post('/api/start', (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: '❌ Form error' });

    const { receiver, name, delay } = fields;
    const delaySec = parseInt(delay) || 2;

    if (!receiver || !name || !files.file) {
      return res.status(400).json({ error: '❌ All fields are required' });
    }

    const receivers = receiver.split(',').map(n => n.trim()).filter(n => /^\d{10,15}$/.test(n));
    if (!receivers.length) return res.status(400).json({ error: '❌ Invalid numbers' });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = file.filepath || file.path;

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return res.status(400).json({ error: '❌ File is empty' });

    if (!sock || !isReady) return res.status(400).json({ error: '❌ WhatsApp not connected' });

    isLooping = true;

    (async function sendLoop() {
      while (isLooping) {
        for (const jidNum of receivers) {
          const jid = jidNum + '@s.whatsapp.net';
          for (const line of lines) {
            if (!isLooping) break;
            const msg = `${name} ${line}`;
            await sock.sendMessage(jid, { text: msg });
            await new Promise(r => setTimeout(r, delaySec * 1000));
          }
        }
      }
    })();

    res.json({ message: `✅ Sending started to ${receivers.length} number(s)` });
  });
});

app.post('/api/stop', (req, res) => {
  isLooping = false;
  res.json({ message: '🛑 Sending stopped.' });
});

app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
      
