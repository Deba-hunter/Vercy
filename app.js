// ✅ app.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const moment = require('moment-timezone');
const formidable = require('formidable');
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
let messageLogs = [];
let globalConfig = { name: '', delay: 2, lines: [] };
let activeLoops = {}; // key: jid, value: boolean

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Aadi Server', 'Chrome', '1.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) qrData = qr;
    if (connection === 'open') {
      isReady = true;
      qrData = null;
    }
    if (connection === 'close') {
      isReady = false;
      qrData = null;
      globalSocket = null;
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        setTimeout(startSocket, 3000);
      } else {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
        fs.mkdirSync(sessionFolder);
        setTimeout(startSocket, 1000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    const from = msg.key.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    if (!text) return;

    if (text.trim() === '.' && !activeLoops[from] && globalConfig.lines.length > 0) {
      activeLoops[from] = true;
      const timestamp = moment().tz("Asia/Kolkata").format("hh:mm:ss A");
      messageLogs.push(`[${timestamp}] 🚀 '.' triggered from ${from}`);

      const loopSend = async () => {
        while (activeLoops[from]) {
          for (const raw of globalConfig.lines) {
            if (!activeLoops[from]) break;
            const msgText = raw.replace(/{name}/gi, globalConfig.name);
            try {
              await sock.sendMessage(from, { text: msgText });
              const ts = moment().tz("Asia/Kolkata").format("hh:mm:ss A");
              messageLogs.push(`[${ts}] ✅ Sent to ${from}: ${msgText}`);
            } catch {
              const ts = moment().tz("Asia/Kolkata").format("hh:mm:ss A");
              messageLogs.push(`[${ts}] ❌ Failed to send to ${from}: ${msgText}`);
            }
            await new Promise(res => setTimeout(res, globalConfig.delay * 1000));
          }
        }
      };
      loopSend();
    }

    if (text.trim() === '.stop' && activeLoops[from]) {
      activeLoops[from] = false;
      const timestamp = moment().tz("Asia/Kolkata").format("hh:mm:ss A");
      messageLogs.push(`[${timestamp}] 🛑 '.stop' received from ${from}`);
    }
  });

  globalSocket = sock;
}
startSocket();

app.get('/api/qr', async (req, res) => {
  if (isReady) return res.json({ message: '✅ Already connected' });
  if (!qrData) return res.json({ message: '⏳ QR not ready' });
  const img = await qrcode.toDataURL(qrData);
  res.json({ qr: img });
});

app.post('/api/start', (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const name = (fields.name || '').toString().trim();
    const delay = parseInt(fields.delay) || 2;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const filepath = file.filepath || file.path;
    const lines = fs.readFileSync(filepath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return res.status(400).json({ error: 'File empty' });

    globalConfig = { name, delay, lines };
    res.json({ message: '✅ Config loaded. Send "." in WhatsApp to start.' });
  });
});

app.get('/api/logs', (req, res) => {
  res.json({ logs: messageLogs });
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
