'use strict';

/**
 * commands/antiedit.js
 *
 * Toggle command:  *antiedit on | off
 * Detection:       onEdit(sock, updates, state, session)
 *                  — called by events/messages.js on 'messages.update'
 * Cache:           cacheMessage(msg)
 *                  — called by events/messages.js on every 'messages.upsert'
 *
 * How edits look in Baileys v6:
 *   'messages.update' fires with an array of update objects.
 *   Each edit looks like ONE of:
 *
 *   A) update.update.message.protocolMessage.type === 14 (MESSAGE_EDIT)
 *      New text lives at: update.update.message.protocolMessage.editedMessage
 *
 *   B) update.update.message.editedMessage  (rare, some Baileys builds)
 *
 *   The user's snippet checked update.update.message.extendedTextMessage —
 *   that path is for NEW messages, not edits. It will NEVER match an edit.
 */

const NodeCache = require('node-cache');

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
  return '[Media]';
}

/**
 * Extract the new text from an edit update.
 * Returns null if this update is NOT an edit.
 *
 * Baileys v6 edit shape:
 *   update = {
 *     key: { remoteJid, id, fromMe },
 *     update: {
 *       message: {
 *         protocolMessage: {
 *           type: 14,                   ← MESSAGE_EDIT
 *           editedMessage: {
 *             conversation: "new text"
 *             // OR extendedTextMessage: { text: "new text" }
 *           }
 *         }
 *       }
 *     }
 *   }
 */
function extractEdit(update) {
  const upd = update?.update;

  // Path A — protocolMessage type 14 (most common in Baileys v6)
  const pm = upd?.message?.protocolMessage;
  if (pm && pm.type === 14 && pm.editedMessage) {
    const em = pm.editedMessage;
    const newText =
      em.conversation ||
      em.extendedTextMessage?.text ||
      em.imageMessage?.caption ||
      em.videoMessage?.caption ||
      '[edited]';
    return { newText };
  }

  // Path B — direct editedMessage field
  const em = upd?.message?.editedMessage;
  if (em) {
    const newText =
      em.conversation ||
      em.extendedTextMessage?.text ||
      '[edited]';
    return { newText };
  }

  return null; // not an edit
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by messages.js on every upsert.
 */
function cacheMessage(rawMsg) {
  if (!rawMsg?.key?.id || !rawMsg.message) return;
  msgCache.set(rawMsg.key.id, {
    from:   rawMsg.key.remoteJid,
    fromMe: !!rawMsg.key.fromMe,
    sender: rawMsg.key.participant || rawMsg.key.remoteJid,
    label:  messageLabel(rawMsg),
    ts:     rawMsg.messageTimestamp,
  });
}

/**
 * Called by messages.js on 'messages.update'.
 * Only acts when state.antiedit === true.
 */
async function onEdit(sock, updates, state, session) {
  if (!state?.antiedit) return;

  for (const update of updates) {
    try {
      const edit = extractEdit(update);
      if (!edit) continue; // not an edit event

      const msgId = update.key?.id;
      const from  = update.key?.remoteJid;
      const c     = msgId ? msgCache.get(msgId) : null;

      const originalText = c?.label || '[original not cached]';
      const newText      = edit.newText;
      const senderNum    = (update.key?.participant || c?.sender || from || '')
        .split('@')[0].split(':')[0];
      const isGroup      = from?.endsWith('@g.us');
      const ownerPhone   = session?.phoneNumber || '';
      const ownerJid     = ownerPhone ? ownerPhone.replace(/\D/g, '') + '@s.whatsapp.net' : null;

      // Alert goes to owner DM if known, otherwise same chat
      const dest = ownerJid || from;

      await sock.sendMessage(dest, {
        text: [
          `✏️ *ANTIEDIT — Message Edited*`,
          ``,
          `*From:*  +${senderNum}`,
          `*Chat:*  ${isGroup ? 'Group' : 'Private DM'}`,
          ``,
          `*Original:*\n${originalText}`,
          ``,
          `*Edited to:*\n${newText}`,
        ].join('\n'),
      });

    } catch (e) {
      // Never crash the pipeline
    }
  }
}

// ── Toggle command handler ────────────────────────────────────────────────────

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'on') {
    state.antiedit = true;
    return sock.sendMessage(from, {
      text: `✏️ *Antiedit Enabled!* ✅\n\nWhen someone edits a message, both the *original* and *edited* versions will be shown.`,
    });
  }

  if (sub === 'off') {
    state.antiedit = false;
    return sock.sendMessage(from, {
      text: `✏️ *Antiedit Disabled.* ❌\n\nMessage edits will no longer be tracked.`,
    });
  }

  return sock.sendMessage(from, {
    text: `✏️ *Antiedit* — Status: ${state.antiedit ? '✅ ON' : '❌ OFF'}\n\n📌 *Usage:*\n*antiedit on* — Enable\n*antiedit off* — Disable`,
  });
}

module.exports = { handle, cacheMessage, onEdit };
