'use strict';

/**
 * utils/messageContext.js — CENTRALIZED Baileys MD message parsing layer.
 *
 * ALL commands and listeners must import from here instead of directly
 * accessing extendedTextMessage only. Modern WA MD wraps content in many
 * different outer types — this module normalises all of them.
 *
 * Exports:
 *   extractText(msg)       — body text from any message type
 *   resolveMessage(msg)    — the inner Baileys message object
 *   resolveContext(msg)    — contextInfo from any message type
 *   resolveQuoted(msg)     — quoted message object
 *   resolveMentions(msg)   — array of mentioned JIDs
 *   resolveMediaType(msg)  — 'image'|'video'|'audio'|'document'|'sticker'|null
 *   isStatus(msg)          — true when from status@broadcast
 *   isViewOnce(msg)        — true when msg is a view-once media
 *   isReaction(msg)        — true when msg is a reactionMessage
 *   unwrapViewOnce(msg)    — unwrap all VO layers → inner message or null
 *   normalizeJid(jid)      — strip :device suffix → plain user JID
 *   cleanNum(jid)          — strip @domain and :device → bare phone number
 *   selfJid(phone)         — phone → 447911123456@s.whatsapp.net
 */

// ─── resolveMessage ───────────────────────────────────────────────────────────
/**
 * Returns the message's inner content object.
 * Works whether Baileys gives us a top-level key or wraps it in ephemeral/document.
 */
function resolveMessage(msg) {
  if (!msg?.message) return null;
  const m = msg.message;
  // Ephemeral wrapper
  if (m.ephemeralMessage?.message) return m.ephemeralMessage.message;
  // Document-with-caption sometimes wraps
  if (m.documentWithCaptionMessage?.message) return m.documentWithCaptionMessage.message;
  return m;
}

// ─── extractText ──────────────────────────────────────────────────────────────
/**
 * Extracts the visible text body from any message type.
 * Never throws. Returns '' if no text found.
 */
function extractText(msg) {
  const m = resolveMessage(msg);
  if (!m) return '';
  return (
    m.conversation                                           ||
    m.extendedTextMessage?.text                              ||
    m.imageMessage?.caption                                  ||
    m.videoMessage?.caption                                  ||
    m.documentMessage?.caption                               ||
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId               ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId  ||
    m.templateButtonReplyMessage?.selectedId                 ||
    m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    ''
  );
}

// ─── resolveContext ───────────────────────────────────────────────────────────
/**
 * Returns contextInfo regardless of which outer message type carries it.
 * Handles: extendedText / image / video / audio / document / sticker /
 *          reaction / ephemeral / documentWithCaption.
 */
function resolveContext(msg) {
  const m = resolveMessage(msg);
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo         ||
    m.imageMessage?.contextInfo                ||
    m.videoMessage?.contextInfo                ||
    m.audioMessage?.contextInfo                ||
    m.documentMessage?.contextInfo             ||
    m.documentWithCaptionMessage?.message?.documentMessage?.contextInfo ||
    m.stickerMessage?.contextInfo              ||
    m.reactionMessage?.key && null             || // reactions use .key not contextInfo
    null
  );
}

// ─── resolveQuoted ────────────────────────────────────────────────────────────
/**
 * Returns the quoted/replied-to message object, or null.
 */
function resolveQuoted(msg) {
  return resolveContext(msg)?.quotedMessage || null;
}

// ─── resolveMentions ──────────────────────────────────────────────────────────
/**
 * Returns array of all mentioned JIDs.
 * Normalises MD device suffixes so consumers get plain user JIDs.
 */
function resolveMentions(msg) {
  const ctx = resolveContext(msg);
  if (!ctx?.mentionedJid?.length) return [];
  return ctx.mentionedJid.map(normalizeJid).filter(Boolean);
}

// ─── resolveMediaType ─────────────────────────────────────────────────────────
/**
 * Returns the media type string of the message, or null for text.
 */
function resolveMediaType(msg) {
  const m = resolveMessage(msg);
  if (!m) return null;
  if (m.imageMessage)    return 'image';
  if (m.videoMessage)    return 'video';
  if (m.audioMessage)    return 'audio';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage)  return 'sticker';
  const inner =
    m.viewOnceMessage?.message          ||
    m.viewOnceMessageV2?.message        ||
    m.viewOnceMessageV2Extension?.message;
  if (inner?.imageMessage)   return 'image';
  if (inner?.videoMessage)   return 'video';
  if (inner?.audioMessage)   return 'audio';
  return null;
}

// ─── isStatus ─────────────────────────────────────────────────────────────────
function isStatus(msg) {
  return (
    msg?.key?.remoteJid === 'status@broadcast' ||
    resolveContext(msg)?.remoteJid === 'status@broadcast'
  );
}

// ─── isViewOnce ───────────────────────────────────────────────────────────────
function isViewOnce(msg) {
  const m = resolveMessage(msg);
  if (!m) return false;
  return !!(
    m.viewOnceMessage          ||
    m.viewOnceMessageV2        ||
    m.viewOnceMessageV2Extension
  );
}

// ─── isReaction ───────────────────────────────────────────────────────────────
/**
 * True when the message is a WhatsApp reaction (reactionMessage).
 * Modern WA sends emoji reactions as reactionMessage, NOT as extendedTextMessage.
 * This is the correct detection path for view-once reveal and status-save
 * triggered by an emoji reaction.
 */
function isReaction(msg) {
  return !!(msg?.message?.reactionMessage);
}

// ─── unwrapViewOnce ───────────────────────────────────────────────────────────
/**
 * Unwrap ALL view-once container formats and return the inner message
 * containing imageMessage / videoMessage / audioMessage.
 * Returns null if not a view-once or no inner media found.
 */
function unwrapViewOnce(msgOrContent) {
  const m = typeof msgOrContent?.message !== 'undefined'
    ? resolveMessage(msgOrContent)
    : msgOrContent;
  if (!m) return null;

  const inner =
    m.viewOnceMessage?.message                             ||
    m.viewOnceMessageV2?.message                           ||
    m.viewOnceMessageV2Extension?.message                  ||
    // Some Baileys versions double-nest it
    m.viewOnceMessage?.message?.viewOnceMessage?.message   ||
    null;

  if (!inner) return null;
  // Verify it actually contains media
  if (inner.imageMessage || inner.videoMessage || inner.audioMessage) return inner;
  return null;
}

// ─── JID utilities ────────────────────────────────────────────────────────────
/**
 * Normalize any JID format to plain user JID.
 *   447911123456:0@s.whatsapp.net → 447911123456@s.whatsapp.net
 *   447911123456@s.whatsapp.net   → 447911123456@s.whatsapp.net
 *   447911123456                  → 447911123456@s.whatsapp.net
 */
function normalizeJid(raw) {
  if (!raw) return null;
  const withoutDomain = String(raw).split('@')[0];
  const withoutDevice = withoutDomain.split(':')[0];
  const digits = withoutDevice.replace(/\D/g, '');
  if (!digits) return null;
  return digits + '@s.whatsapp.net';
}

/**
 * Strip @domain and :device → bare phone number string.
 *   447911123456:0@s.whatsapp.net → "447911123456"
 */
function cleanNum(jid) {
  return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/**
 * Phone number string → self-JID used for "Message Yourself".
 *   "447911123456" → "447911123456@s.whatsapp.net"
 */
function selfJid(phone) {
  return String(phone || '').replace(/\D/g, '') + '@s.whatsapp.net';
}

module.exports = {
  extractText,
  resolveMessage,
  resolveContext,
  resolveQuoted,
  resolveMentions,
  resolveMediaType,
  isStatus,
  isViewOnce,
  isReaction,
  unwrapViewOnce,
  normalizeJid,
  cleanNum,
  selfJid,
};
