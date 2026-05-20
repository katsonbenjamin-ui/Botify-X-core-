'use strict';

async function handle({ sock, from, msg }) {
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message or @mention someone to unblock them.*\n\n📌 Usage: *unblock',
    });
  }
  const jid = target.includes('@') ? target : target + '@s.whatsapp.net';
  try {
    await sock.updateBlockStatus(jid, 'unblock');
    return sock.sendMessage(from, {
      text: `✅ *Unblocked!*\n\n+${jid.split('@')[0]} has been unblocked and can contact you again.`,
    });
  } catch (e) {
    console.error('[Unblock]', e.message);
    return sock.sendMessage(from, { text: '❌ Failed to unblock. Please try again.' });
  }
}

module.exports = { handle };
