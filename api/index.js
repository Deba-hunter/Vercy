const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('baileys');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');

module.exports = async (req, res) => {
  const sessionFolder = '/tmp/session'; // ✅ Safe for Vercel
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

  // ====== LOGIN CODE GENERATION (GET) ======
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (!sock.authState.creds.registered) {
        const phoneNumber = sock.user?.id?.split(':')[0];
        if (!phoneNumber) return res.status(500).json({ error: 'User ID not available' });

        const { code } = await sock.requestPairingCode(phoneNumber);
        return res.status(200).json({ code });
      } else {
        return res.status(200).json({ message: 'Already logged in' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Login failed', detail: err.message });
    }
  }

  // ====== SEND MESSAGE / FILE (POST) ======
  if (req.method === 'POST') {
    const form = new formidable.IncomingForm({ multiples: false });
    form.uploadDir = '/tmp';

    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: 'Form parse error' });

      const { receiver, message, delay } = fields;
      const delaySec = parseInt(delay) || 2;

      try {
        const jid = receiver + '@s.whatsapp.net';

        if (files.file) {
          const fileField = Array.isArray(files.file) ? files.file[0] : files.file;
          const filePath = fileField.filepath || fileField.path;

          const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

          for (const line of lines) {
            await sock.sendMessage(jid, { text: line });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }

          return res.status(200).json({ message: `Messages sent from file to ${receiver}` });

        } else if (receiver && message) {
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
            
