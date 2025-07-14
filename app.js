// app.js
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
    browser: ['Bot', 'Chrome', '1.0'],
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

// QR CODE API
app.get('/api/qr', async (req, res) => {
  if (isReady) return res.json({ message: '✅ Already authenticated!' });
  if (!qrData) return res.json({ message: '⏳ QR code not ready yet.' });
  const qrImage = await qrcode.toDataURL(qrData);
  res.json({ qr: qrImage });
});

// START API
app.post('/api/start', (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const receiver = (fields.receiver || "").toString().trim();
    const name = (fields.name || "").toString().trim();
    const delaySec = parseInt(fields.delay) || 2;

    if (!receiver) {
      return res.status(400).json({ error: '❌ Receiver required' });
    }

    let jid;
    if (/^\d{10,15}$/.test(receiver)) {
      jid = receiver + '@s.whatsapp.net';
    } else if (receiver.endsWith('@g.us')) {
      jid = receiver;
    } else {
      return res.status(400).json({ error: '❌ Invalid receiver. Use phone number or group ID.' });
    }

    if (!files.file) return res.status(400).json({ error: '❌ File required' });

    const sock = globalSocket;
    if (!sock || !isReady) return res.status(400).json({ error: '❌ WhatsApp not connected' });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const filePath = file.filepath || file.path;
    const lines = fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const personalizedLines = lines.map(line => line.replace(/{name}/gi, name));

    if (personalizedLines.length === 0) {
      return res.status(400).json({ error: '❌ File is empty.' });
    }

    isLooping = true;

    const sendMessages = async () => {
      while (isLooping) {
        for (const line of personalizedLines) {
          if (!isLooping) break;
          await sock.sendMessage(jid, { text: line });
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
  res.json({ message: '🛑 Message sending stopped.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
    
