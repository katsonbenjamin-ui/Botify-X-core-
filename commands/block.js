'use strict';

/**
 * *block — block a contact.
 *
 * FIXES:
 *   • Uses normalizeJid() + resolveMentions() from messageContext
 *   • Supports: reply block / mention block / raw number block
 *   • Strips MD device suffix before calling updateBlockStatus
 */

const { resolveContext, resolveMentions, normalizeJid } = require('../utils/messageContext');

async function handle({ sock, from, msg, args }) {
  const m   = msg.message;
  if (!m) return sock.sendMessage(from, { text: '❌ No message content.' });

  const ctx      = resolveContext(msg);
  const mentions = resolveMentions(msg);

  // Priority: reply author → @mention → raw number arg
  let rawTarget =
    ctx?.participant ||            // reply → who sent the quoted message
    mentions[0]      ||            // @mention
    (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : null); // raw number

  if (!rawTarget) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to, @mention, or type the number to block.*\n📌 Usage:\n*block (reply)\n*block @user\n*block 447911123456',
    });
  }

  const jid = normalizeJid(rawTarget);
  if (!jid) {
    return sock.sendMessage(from, { text: '❌ Could not resolve a valid JID to block.' });
  }

  const displayNum = jid.split('@')[0];

  try {
    await sock.updateBlockStatus(jid, 'block');
    console.log('[Block] Blocked:', jid);
    return sock.sendMessage(from, {
      text: `🚫 *Blocked!*\n\n+${displayNum} has been blocked and can no longer contact you.`,
    });
  } catch (e) {
    console.error('[Block] Failed for', jid, '—', e.message);
    return sock.sendMessage(from, {
      text: `❌ Block failed for +${displayNum}.\n_${e.message}_`,
    });
  }
}

module.exports = { handle };
