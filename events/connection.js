'use strict';

const { setConnected }        = require('../utils/botState');
const { getSessionOwnerMode } = require('../utils/dataManager');

// WhatsApp channel to follow automatically after every successful pairing
const CHANNEL_JID = '0029VbCgsEh5a23yTg0FnW2O@newsletter';

async function onOpen({ session }) {
  const { sock } = session;
  setConnected(true);
  console.log('[BOTIFY X] ✅ WhatsApp connected!');

  const phone = session.phoneNumber
    || process.env.OWNER_NUMBER
    || process.env.ADMIN_NUMBER
    || '';

  // Auto-follow the channel silently on every connection
  try {
    if (typeof sock.newsletterFollow === 'function') {
      await sock.newsletterFollow(CHANNEL_JID);
    }
  } catch (_) {
    // Silently ignore — not all Baileys builds expose this method
  }

  if (!phone) return;

  const jid     = phone.replace(/\D/g, '') + '@s.whatsapp.net';
  const mode    = getSessionOwnerMode(phone);
  const modeStr = mode === 'public' ? '🌍 Public' : '🔒 Private';

  const msg = `┏▣ ◈ BOTIFY-X ◈
┃ ✅ *Connected successfully!*
┃
┃ ᴘʀᴇғɪx   : [ * ]
┃ ᴍᴏᴅᴇ     : ${modeStr}
┃ ᴠᴇʀsɪᴏɴ  : v1.1.4
┗▣`;

  setTimeout(() => sock.sendMessage(jid, { text: msg }).catch(() => {}), 3000);
}

module.exports = { onOpen };
