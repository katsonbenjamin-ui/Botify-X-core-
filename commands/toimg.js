'use strict';

/**
 * *toimg — convert a sticker (WebP) to a viewable image (PNG).
 * Reply to a sticker with *toimg.
 *
 * Fire-and-forget: handle() returns immediately; conversion runs in background.
 * Requires: ffmpeg (nixpacks.toml: nixPkgs = ["ffmpeg"])
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
  const m   = msg.message;
  const ctx = m?.extendedTextMessage?.contextInfo;

  const directSticker = m?.stickerMessage;
  const quotedSticker = ctx?.quotedMessage?.stickerMessage;

  if (!directSticker && !quotedSticker) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a sticker to convert it to an image.*\n📌 Usage: *toimg',
    });
  }

  // Fire-and-forget
  setImmediate(async () => {
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
        return sock.sendMessage(from, {
          text: '❌ Could not download sticker. It may have expired.',
        });
      }

      const inFile  = tmpPath('.webp');
      const outFile = tmpPath('.png');
      try {
        fs.writeFileSync(inFile, buf);
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
      const hint = e.message.includes('ENOENT')
        ? '\n⚠️ _ffmpeg not found — check nixpacks.toml_' : '';
      try { await sock.sendMessage(from, { text: `❌ Conversion failed: ${e.message}${hint}` }); } catch {}
    }
  });
}

module.exports = { handle };
