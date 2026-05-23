'use strict';

/**
 * *vv — reveal a view-once message by replying to it.
 *
 * Fixes vs old version:
 * - Handles viewOnceMessageV2 / viewOnceMessageV2Extension more robustly.
 * - Correct stanzaId/participant resolution for download.
 * - handleSecret now also supports audio view-once.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info() {}, error() {}, warn() {}, debug() {}, trace() {},
  child() { return this; },
};

/**
 * Unwrap all known view-once container formats.
 * Returns the inner message object that contains imageMessage/videoMessage/audioMessage.
 */
function unwrapVO(msgContent) {
  if (!msgContent) return null;
  return (
    msgContent.viewOnceMessage?.message          ||
    msgContent.viewOnceMessageV2?.message        ||
    msgContent.viewOnceMessageV2Extension?.message ||
    // Some Baileys versions nest it one level deeper
    msgContent.viewOnceMessage?.message?.viewOnceMessage?.message ||
    null
  );
}

function mediaType(inner) {
  if (!inner) return null;
  if (inner.imageMessage) return 'image';
  if (inner.videoMessage) return 'video';
  if (inner.audioMessage) return 'audio';
  return null;
}

/**
 * *vv — manual reveal, sends to current chat.
 */
async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) {
    return sock.sendMessage(from, { text: '❌ *Reply to a view-once message to reveal it.*' });
  }

  const qm    = ctx.quotedMessage;
  const inner = unwrapVO(qm) || qm;
  const type  = mediaType(inner);

  if (!type) {
    return sock.sendMessage(from, { text: '❌ No view-once media found in the quoted message.' });
  }

  try {
    const fake = {
      key: {
        remoteJid:   ctx.remoteJid || from,
        id:          ctx.stanzaId  || msg.key.id,
        participant: ctx.participant || null,
        fromMe:      false,
      },
      message: inner,
    };

    let buf;
    try {
      buf = await downloadMediaMessage(
        fake, 'buffer', {},
        { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
      );
    } catch (_) {
      buf = await downloadMediaMessage(fake, 'buffer', {}, { logger: SLOG });
    }

    if (type === 'image') await sock.sendMessage(from, { image: buf });
    else if (type === 'video') await sock.sendMessage(from, { video: buf });
    else if (type === 'audio') await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mp4' });
  } catch (e) {
    console.error('[VV]', e.message);
    await sock.sendMessage(from, { text: '❌ Could not reveal — media may have expired.' });
  }
}

/**
 * handleSecret — auto-triggered when anyone replies to a view-once with only emojis.
 * Sends raw media ONLY to the session owner's "Message Yourself".
 */
async function handleSecret(sock, msg, destJid) {
  if (!destJid) return;

  const inner = msg.message;
  if (!inner) return;

  const type = mediaType(inner);
  if (!type) return;

  try {
    let buf;
    try {
      buf = await downloadMediaMessage(
        msg, 'buffer', {},
        { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
      );
    } catch (_) {
      buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: SLOG });
    }

    if (!buf || buf.length === 0) return;

    if (type === 'image') await sock.sendMessage(destJid, { image: buf });
    else if (type === 'video') await sock.sendMessage(destJid, { video: buf });
    else if (type === 'audio') await sock.sendMessage(destJid, { audio: buf, mimetype: 'audio/mp4' });
  } catch (e) {
    console.error('[VV Secret]', e.message);
  }
}

module.exports = { handle, handleSecret };
