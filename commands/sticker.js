'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info() {}, error() {}, warn() {}, debug() {}, trace() {},
  child() { return this; },
};

/**
 * *sticker / *s — convert a replied image or video into a WhatsApp sticker.
 * Supports: direct image/video message, or reply to an image/video.
 */
async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;

  // Determine the source message (direct or quoted)
  const directImg = msg.message?.imageMessage;
  const directVid = msg.message?.videoMessage;
  const quotedImg = ctx?.quotedMessage?.imageMessage;
  const quotedVid = ctx?.quotedMessage?.videoMessage;

  const hasMedia = directImg || directVid || quotedImg || quotedVid;
  if (!hasMedia) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to an image or video to make a sticker.*\n📌 Usage: *sticker (or *s)',
    });
  }

  try {
    let target;

    if (directImg || directVid) {
      // The command message itself contains the media
      target = msg;
    } else {
      // Quoted message contains the media
      target = {
        key: {
          remoteJid:   from,
          id:          ctx.stanzaId || msg.key.id,
          participant: ctx.participant || null,
          fromMe:      false,
        },
        message: ctx.quotedMessage,
      };
    }

    // Download with reupload support for expired media
    let buf;
    try {
      buf = await downloadMediaMessage(
        target,
        'buffer',
        {},
        { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
      );
    } catch (_) {
      // Fallback without reupload
      buf = await downloadMediaMessage(target, 'buffer', {}, { logger: SLOG });
    }

    if (!buf || buf.length === 0) {
      return sock.sendMessage(from, { text: '❌ Could not download the media. It may have expired.' });
    }

    // Send as sticker — WhatsApp clients handle webp conversion on most versions
    await sock.sendMessage(from, {
      sticker: buf,
    });
  } catch (e) {
    console.error('[Sticker]', e.message);
    await sock.sendMessage(from, { text: `❌ Failed to create sticker: ${e.message}` });
  }
}

module.exports = { handle };
