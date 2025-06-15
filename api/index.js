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

  // 1️⃣ LOGIN: Get Code
  if (req.method === 'GET') {
    try {
      if (!sock.authState.creds.registered) {
        const { code } = await sock.requestPairingCode(sock.user.id.split(':')[0]);
        return res.status(200).json({ code });
      } else {
        return res.status(200).json({ message: 'Already logged in' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Login failed', detail: err.message });
    }
  }

  // 2️⃣ SEND MESSAGE OR FILE
  if (req.method === 'POST') {
    const form = new formidable.IncomingForm({ multiples: false });
    form.uploadDir = '/tmp';

    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: 'Form parse error' });

      const { receiver, message, delay } = fields;
      const delaySec = parseInt(delay) || 2;

      try {
        const jid = receiver + '@s.whatsapp.net';

        // ✅ File-based message sending
        if (files.file) {
          const fileField = Array.isArray(files.file) ? files.file[0] : files.file;
          const filePath = fileField.filepath;
          const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

          for (const line of lines) {
            await sock.sendMessage(jid, { text: line });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }

          return res.status(200).json({ message: `Messages sent from file to ${receiver}` });

        } else if (receiver && message) {
          // ✅ Manual message
          await sock.sendMessage(jid, { text: message });
          return res.status(200).json({ message: `Message sent to ${receiver}` });

        } else {
          return res.status(400).json({ error: 'Missing receiver or message/file' });
        }
      } catch (err) {
        return res.status(500).json({ error: 'Sending failed', detail: err.message });
      }
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};
