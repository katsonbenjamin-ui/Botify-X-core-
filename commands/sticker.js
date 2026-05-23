'use strict';

/**
 * *sticker / *s — convert a replied image or video into a WhatsApp sticker.
 *
 * Fixes vs old version:
 * - Uses ffmpeg to produce a proper WebP file (static or animated).
 * - No sharp dependency — Railway-safe.
 * - Temp files are cleaned up regardless of success/failure.
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
  return path.join(os.tmpdir(), 'stk_' + crypto.randomBytes(8).toString('hex') + ext);
}

/**
 * Convert raw media buffer → WebP sticker buffer via ffmpeg.
 * @param {Buffer} buf      raw media bytes
 * @param {boolean} isVideo true → animated WebP (max 3 s / 10 fps)
 */
async function toWebp(buf, isVideo) {
  const inFile  = tmpPath(isVideo ? '.mp4' : '.jpg');
  const outFile = tmpPath('.webp');
  try {
    fs.writeFileSync(inFile, buf);

    const vf = 'scale=512:512:force_original_aspect_ratio=decrease,' +
               'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0' +
               (isVideo ? ',fps=10' : '');

    const args = [
      '-y', '-i', inFile,
      ...(isVideo ? ['-t', '3'] : []),
      '-vf', vf,
      '-vcodec', 'libwebp',
      '-lossless', '0',
      '-compression_level', '6',
      '-q:v', isVideo ? '70' : '80',
      ...(isVideo ? ['-loop', '0', '-preset', 'picture', '-an'] : ['-an']),
      outFile,
    ];

    await execFileAsync('ffmpeg', args, { timeout: 30_000 });
    return fs.readFileSync(outFile);
  } finally {
    try { fs.unlinkSync(inFile);  } catch {}
    try { fs.unlinkSync(outFile); } catch {}
  }
}

async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;

  const directImg = msg.message?.imageMessage;
  const directVid = msg.message?.videoMessage;
  const quotedImg = ctx?.quotedMessage?.imageMessage;
  const quotedVid = ctx?.quotedMessage?.videoMessage;

  if (!directImg && !directVid && !quotedImg && !quotedVid) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to an image or video to make a sticker.*\n📌 Usage: *sticker (or *s)',
    });
  }

  const isVideo = !!(directVid || quotedVid);

  try {
    let target;
    if (directImg || directVid) {
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

    // Download raw media bytes
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
      return sock.sendMessage(from, { text: '❌ Could not download the media. It may have expired.' });
    }

    // Convert to proper WebP via ffmpeg
    const webp = await toWebp(buf, isVideo);

    await sock.sendMessage(from, { sticker: webp });

  } catch (e) {
    console.error('[Sticker]', e.message);
    await sock.sendMessage(from, { text: `❌ Failed to create sticker: ${e.message}` });
  }
}

module.exports = { handle };
