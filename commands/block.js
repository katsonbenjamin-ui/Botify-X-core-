'use strict';

/**
 * *block — block a contact so they cannot message the linked WhatsApp account.
 *
 * FIX: JID normalization strips MD device suffixes.
 * Modern Baileys uses number:device@s.whatsapp.net — we must strip to number@s.whatsapp.net
 * before calling updateBlockStatus(), otherwise it silently fails.
 */

/**
 * Normalize any JID format to a plain user JID:
 *   447911123456:0@s.whatsapp.net  → 447911123456@s.whatsapp.net
 *   447911123456@s.whatsapp.net    → 447911123456@s.whatsapp.net
 *   447911123456                   → 447911123456@s.whatsapp.net
 */
function normalizeJid(raw) {
  if (!raw) return null;
  const withoutDomain = raw.split('@')[0]; // strip @s.whatsapp.net / @g.us etc.
  const withoutDevice = withoutDomain.split(':')[0]; // strip :0 device suffix
  const digits = withoutDevice.replace(/\D/g, '');
  if (!digits) return null;
  return digits + '@s.whatsapp.net';
}

async function handle({ sock, from, msg }) {
  const m   = msg.message;
  if (!m) return sock.sendMessage(from, { text: '❌ Reply to a message or @mention someone to block.' });

  // Extract target from reply (participant) or @mention
  const ctx = m.extendedTextMessage?.contextInfo
           || m.imageMessage?.contextInfo
           || m.videoMessage?.contextInfo
           || m.audioMessage?.contextInfo
           || m.documentMessage?.contextInfo
           || null;

  const rawTarget = ctx?.participant || ctx?.mentionedJid?.[0] || null;

  if (!rawTarget) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message or @mention someone to block them.*\n\n📌 Usage: *block',
    });
  }

  const jid = normalizeJid(rawTarget);
  if (!jid) {
    return sock.sendMessage(from, { text: '❌ Could not resolve target JID.' });
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
      text: `❌ Block failed for +${displayNum}.\n_Error: ${e.message}_`,
    });
  }
}

module.exports = { handle };
