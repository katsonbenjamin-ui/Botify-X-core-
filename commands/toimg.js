'use strict';

/**
 * *toimg — convert a sticker (WebP) to a regular image.
 * Reply to a sticker with *toimg to receive it as a viewable image.
 *
 * ffmpeg-based, no sharp. Railway + Oracle ARM safe.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { execFile }  = require('child_process');
const { promisify } = require('util');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

const SLOG = {
  level: 'silent',
  info() {}, error() {}, warn() {}, debug() {}, trace() {},
  child() { return this; },
};

function tmpPath(ext) {
  return path.join(os.tmpdir(), 'toimg_' + crypto.randomBytes(8).toString('hex') + ext);
}

async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const directSticker = msg.message?.stickerMessage;
  const quotedSticker = ctx?.quotedMessage?.stickerMessage;

  if (!directSticker && !quotedSticker) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a sticker to convert it to an image.*\n📌 Usage: *toimg',
    });
  }

  try {
    let target;
    if (directSticker) {
      target = msg;
    } else {
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

    let buf;
    try {
      buf = await downloadMediaMessage(
        target, 'buffer', {},
        { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
      );
    } catch (_) {
      buf = await downloadMediaMessage(target, 'buffer', {}, { logger: SLOG });
    }

    if (!buf || buf.length === 0) {
      return sock.sendMessage(from, { text: '❌ Could not download sticker. It may have expired.' });
    }

    const inFile  = tmpPath('.webp');
    const outFile = tmpPath('.png');
    try {
      fs.writeFileSync(inFile, buf);
      // ffmpeg converts WebP → PNG cleanly on all platforms
      await execFileAsync('ffmpeg', [
        '-y', '-i', inFile, '-vframes', '1', outFile,
      ], { timeout: 20_000 });

      const imgBuf = fs.readFileSync(outFile);
      await sock.sendMessage(from, { image: imgBuf });
    } finally {
      try { fs.unlinkSync(inFile);  } catch {}
      try { fs.unlinkSync(outFile); } catch {}
    }
  } catch (e) {
    console.error('[ToImg]', e.message);
    await sock.sendMessage(from, { text: `❌ Conversion failed: ${e.message}` });
  }
}

module.exports = { handle };
