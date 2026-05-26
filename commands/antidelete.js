'use strict';

/**
 * commands/antidelete.js
 *
 * Toggle command:  *antidelete on | off
 * Detection:       onDelete(sock, item, state, session)
 *                  — called by events/messages.js on 'messages.delete'
 * Cache:           cacheMessage(msg)
 *                  — called by events/messages.js on every 'messages.upsert'
 *
 * How antidelete works in Baileys:
 *   1. Every incoming message is stored in msgCache (keyed by message ID)
 *   2. When 'messages.delete' fires, we look up the original in msgCache
 *   3. We forward the recovered content to the owner / same chat
 */

const NodeCache = require('node-cache');

// Stores up to 30 minutes of messages — survives short disconnects
const msgCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractText(msg) {
  const m = msg?.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  );
}

function messageLabel(msg) {
  const body = extractText(msg);
  if (body) return body;
  const m = msg?.message || {};
  if (m.imageMessage)    return '[Image]';
  if (m.videoMessage)    return '[Video]';
  if (m.audioMessage)    return '[Audio]';
  if (m.documentMessage) return `[Document: ${m.documentMessage.fileName || 'file'}]`;
  if (m.stickerMessage)  return '[Sticker]';
  if (m.viewOnceMessage || m.viewOnceMessageV2) return '[View Once]';
  return '[Media]';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by messages.js on every upsert — stores message so we can
 * recover it if it gets deleted.
 */
function cacheMessage(rawMsg) {
  if (!rawMsg?.key?.id || !rawMsg.message) return;
  msgCache.set(rawMsg.key.id, {
    from:      rawMsg.key.remoteJid,
    fromMe:    !!rawMsg.key.fromMe,
    sender:    rawMsg.key.participant || rawMsg.key.remoteJid,
    label:     messageLabel(rawMsg),
    ts:        rawMsg.messageTimestamp,
  });
}

/**
 * Called by messages.js on 'messages.delete'.
 * Only acts when state.antidelete === true.
 *
 * Baileys fires this event as:
 *   { keys: [ { remoteJid, id, fromMe, participant } ] }
 *   OR (older Baileys): { key: { ... } }
 */
function onDelete(sock, item, state, session) {
  if (!state?.antidelete) return;

  // Normalise to array of keys regardless of Baileys version
  const keys = Array.isArray(item?.keys)
    ? item.keys
    : (item?.key ? [item.key] : []);

  for (const key of keys) {
    // Don't alert on our own deleted messages
    if (key.fromMe) continue;

    const msgId = key.id;
    const c     = msgCache.get(msgId);
    if (!c) continue; // message wasn't cached (bot wasn't connected when it arrived)

    const from        = c.from || key.remoteJid;
    const senderNum   = (key.participant || c.sender || from).split('@')[0].split(':')[0];
    const isGroup     = from?.endsWith('@g.us');
    const ownerPhone  = session?.phoneNumber || '';
    const ownerJid    = ownerPhone ? ownerPhone.replace(/\D/g, '') + '@s.whatsapp.net' : null;

    // Send alert to owner's DM if we know their number, otherwise reply in chat
    const dest = ownerJid || from;

    sock.sendMessage(dest, {
      text: [
        `🗑️ *ANTIDELETE — Deleted Message Recovered*`,
        ``,
        `*From:*  +${senderNum}`,
        `*Chat:*  ${isGroup ? 'Group' : 'Private DM'}`,
        isGroup ? `*Group:* ${from}` : '',
        ``,
        `*Content:*\n${c.label || '[unknown]'}`,
      ].filter(l => l !== null).join('\n'),
    }).catch(() => {});
  }
}

// ── Toggle command handler ────────────────────────────────────────────────────

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'on') {
    state.antidelete = true;
    return sock.sendMessage(from, {
      text: `🗑️ *Antidelete Enabled!* ✅\n\nDeleted messages in your chats and groups will be revealed automatically.`,
    });
  }

  if (sub === 'off') {
    state.antidelete = false;
    return sock.sendMessage(from, {
      text: `🗑️ *Antidelete Disabled.* ❌\n\nDeleted messages will no longer be tracked.`,
    });
  }

  return sock.sendMessage(from, {
    text: `🗑️ *Antidelete* — Status: ${state.antidelete ? '✅ ON' : '❌ OFF'}\n\n📌 *Usage:*\n*antidelete on* — Enable\n*antidelete off* — Disable`,
  });
}

module.exports = { handle, cacheMessage, onDelete };
