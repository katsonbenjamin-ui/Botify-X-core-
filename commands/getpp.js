'use strict';
const axios = require('axios');
async function handle({ sock, from, msg }) {
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) return sock.sendMessage(from, { text: '❌ Reply to or @mention a user.\nUsage: *getpp' });
  try {
    const url = await sock.profilePictureUrl(target, 'image');
    const res = await axios.get(url, { responseType:'arraybuffer', timeout: 10000 });
    await sock.sendMessage(from, {
      image: Buffer.from(res.data),
      caption: `🖼️ Profile picture of @${target.split('@')[0]}`,
      mentions: [target]
    });
  } catch {
    await sock.sendMessage(from, { text: '❌ Could not fetch profile picture (privacy settings may be on).' });
  }
}
module.exports = { handle };
