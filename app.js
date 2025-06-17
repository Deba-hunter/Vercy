const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

app.use(express.static('public'));

let globalSock;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['PairBot', 'Chrome', '1.0'],
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: 'hello' })
  });

  sock.ev.on('creds.update', saveCreds);
  globalSock = sock;
  return sock;
}

startSock();

app.get('/pair', async (req, res) => {
  const number = req.query.number;
  if (!number) return res.status(400).json({ error: 'Phone number required' });

  try {
    const sock = globalSock || await startSock();
    const code = await sock.requestPairingCode(number);
    console.log('🟢 Pairing Code:', code);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/send', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'Form error' });

    const receiver = fields.receiver;
    const delay = parseInt(fields.delay || '2');
    if (!receiver || !files.file) return res.status(400).json({ error: 'Receiver or file missing' });

    try {
      const sock = globalSock || await startSock();
      const jid = receiver + '@s.whatsapp.net';
      const filePath = files.file.filepath || files.file.path;
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

      (async function sendLoop() {
        while (true) {
          for (const line of lines) {
            await sock.sendMessage(jid, { text: line });
            await new Promise(res => setTimeout(res, delay * 1000));
          }
        }
      })();

      res.json({ message: 'Messages started!' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
