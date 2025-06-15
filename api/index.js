const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('baileys');
const path = require('path');
const fs = require('fs');
const formidable = require('formidable');

module.exports = async (req, res) => {
  const sessionFolder = path.resolve(__dirname, 'session');
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Bot', 'Chrome', '1.0'],
    getMessage: async () => ({ conversation: 'hello' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // 1️⃣ Login code GET
  if (req.method === 'GET') {
    if (!sock.authState.creds.registered) {
      const { code } = await sock.requestPairingCode(sock.user.id.split(':')[0]);
      return res.status(200).json({ code });
    } else {
      return res.status(200).json({ message: 'Already logged in' });
    }
  }

  // 2️⃣ Message/File Send POST
  if (req.method === 'POST') {
    const form = new formidable.IncomingForm({ multiples: false });
    form.uploadDir = '/tmp';

    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: 'Form error' });

      const { receiver, message, delay } = fields;
      const delaySec = parseInt(delay) || 2;

      try {
        if (files.file) {
          const filePath = files.file[0].filepath;
          const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

          for (const line of lines) {
            const jid = receiver + '@s.whatsapp.net';
            await sock.sendMessage(jid, { text: line });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }

          return res.status(200).json({ message: `File sent to ${receiver}` });

        } else if (receiver && message) {
          const jid = receiver + '@s.whatsapp.net';
          await sock.sendMessage(jid, { text: message });
          return res.status(200).json({ message: `Message sent to ${receiver}` });
        } else {
          return res.status(400).json({ error: 'Missing receiver/message' });
        }
      } catch (err) {
        return res.status(500).json({ error: 'Sending failed' });
      }
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};
