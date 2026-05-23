'use strict';

/**
 * *block — block a user by replying to their message or @mentioning them.
 *
 * Fixes vs old version:
 * - Checks contextInfo from all message types (not just extendedTextMessage)
 * - Falls back to args[0] as a raw phone number
 * - Normalises JID properly (strips :device suffix added by multi-device)
 */
async function handle({ sock, from, msg, args }) {
  const allMsg = msg.message || {};

  // Pull contextInfo from whichever message type carries it
  const ctx =
    allMsg.extendedTextMessage?.contextInfo ||
    allMsg.imageMessage?.contextInfo       ||
    allMsg.videoMessage?.contextInfo       ||
    allMsg.audioMessage?.contextInfo       ||
    allMsg.documentMessage?.contextInfo    ||
    null;

  // participant = who sent the quoted message (reply target)
  // mentionedJid = @mentioned users list
  let raw =
    ctx?.participant ||
    ctx?.mentionedJid?.[0] ||
    (args[0] ? args[0].replace(/\D/g, '') : null);

  if (!raw) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message or @mention someone to block them.*\n\n📌 Usage: *block',
    });
  }

  // Normalise: strip @s.whatsapp.net / @lid / :device suffix, keep digits only
  const phone = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!phone) {
    return sock.sendMessage(from, {
      text: '❌ Could not determine who to block. Reply to their message or @mention them.',
    });
  }

  const jid = phone + '@s.whatsapp.net';

  try {
    await sock.updateBlockStatus(jid, 'block');
    return sock.sendMessage(from, {
      text: `🚫 *Blocked!*\n\n+${phone} has been blocked and can no longer contact you.`,
    });
  } catch (e) {
    console.error('[Block]', e.message);
    return sock.sendMessage(from, { text: '❌ Failed to block. Please try again.' });
  }
}

module.exports = { handle };
