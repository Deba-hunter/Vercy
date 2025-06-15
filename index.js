const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('baileys');
const { toDataURL } = require('qrcode');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'views')));
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (_, __, cb) => cb(null, 'messages.txt'),
});
const upload = multer({ storage });

let sock, qrData, connected = false;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '..', 'session'));
  sock = makeWASocket({ auth: state, printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, qr }) => {
    if (qr) {
      qrData = await toDataURL(qr);
      connected = false;
    }
    if (connection === 'open') {
      connected = true;
      qrData = null;
      console.log('✅ WhatsApp connected');
    }
    if (connection === 'close') {
      connected = false;
      startSock();
    }
  });
}
startSock();

app.get('/qr', (req, res) => {
  if (!qrData) return res.status(404).send('<h3>QR not ready yet. Please wait...</h3>');
  res.send(`
    <div style="text-align:center;padding:20px">
      <h2>📟 Scan WhatsApp QR</h2>
      <img src="${qrData}" style="max-width:90vw;max-height:90vh;" />
      <p>Then go to <a href="/">/</a> to send messages.</p>
    </div>
  `);
});

app.get('/', (req, res) => {
  if (!connected) return res.redirect('/qr');
  res.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});

app.post('/start', upload.single('messageFile'), async (req, res) => {
  if (!connected) return res.send('❌ Not connected yet.');

  const number = req.body.number.trim();
  const delayMs = Math.max(1, parseInt(req.body.delay)) * 1000;
  const filePath = path.join(__dirname, '..', 'uploads/messages.txt');

  if (!fs.existsSync(filePath)) {
    return res.status(400).send('❌ Message file missing.');
  }

  const messages = fs.readFileSync(filePath, 'utf‑8').split('\n').filter(Boolean);
  const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;

  (async function sendLoop() {
    while (true) {
      for (const msg of messages) {
        await sock.sendMessage(jid, { text: msg });
        console.log(`✅ Sent: ${msg}`);
        await delay(delayMs);
      }
    }
  })();

  res.send('<h3>✅ Messaging started! Check WhatsApp.</h3>');
});

module.exports = app;
