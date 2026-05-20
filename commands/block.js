'use strict';

async function handle({ sock, from, msg }) {
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message or @mention someone to block them.*\n\n📌 Usage: *block',
    });
  }
  const jid = target.includes('@') ? target : target + '@s.whatsapp.net';
  try {
    await sock.updateBlockStatus(jid, 'block');
    return sock.sendMessage(from, {
      text: `🚫 *Blocked!*\n\n+${jid.split('@')[0]} has been blocked and can no longer contact you.`,
    });
  } catch (e) {
    console.error('[Block]', e.message);
    return sock.sendMessage(from, { text: '❌ Failed to block. Please try again.' });
  }
}

module.exports = { handle };
