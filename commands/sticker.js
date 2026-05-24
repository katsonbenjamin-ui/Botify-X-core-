'use strict';

/**
 * *sticker / *s — convert an image or video to a WhatsApp sticker.
 *
 * Uses ffmpeg to produce proper WebP:
 *   Image → static 512×512 WebP (aspect-preserving, white padding)
 *   Video → animated WebP capped at 8s (WhatsApp sticker limit)
 *
 * Fire-and-forget: handle() returns immediately so it never blocks the
 * message loop. The conversion and send happen in the background.
 *
 * Requires: ffmpeg in PATH (add to nixpacks.toml: nixPkgs = ["ffmpeg"])
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

const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB

function tmpPath(ext) {
  return path.join(os.tmpdir(), 'sticker_' + crypto.randomBytes(8).toString('hex') + ext);
}

// Determine content type from message
function getMediaTarget(msg) {
  const m   = msg.message;
  const ctx = m?.extendedTextMessage?.contextInfo;

  const directImg = m?.imageMessage;
  const directVid = m?.videoMessage;
  const quotedImg = ctx?.quotedMessage?.imageMessage;
  const quotedVid = ctx?.quotedMessage?.videoMessage;

  if (directImg) return { target: msg, isVideo: false };
  if (directVid) return { target: msg, isVideo: true };
  if (quotedImg || quotedVid) {
    return {
      target: {
        key: {
          remoteJid:   msg.key.remoteJid,
          id:          ctx.stanzaId || msg.key.id,
          participant: ctx.participant || null,
          fromMe:      false,
        },
        message: ctx.quotedMessage,
      },
      isVideo: !!quotedVid,
    };
  }
  return null;
}

async function convertToSticker(buf, isVideo) {
  const inExt  = isVideo ? '.mp4' : '.jpg';
  const inFile  = tmpPath(inExt);
  const outFile = tmpPath('.webp');

  try {
    fs.writeFileSync(inFile, buf);

    const scaleFilter =
      'scale=512:512:force_original_aspect_ratio=decrease,' +
      'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0,setsar=1';

    if (isVideo) {
      // Animated WebP — max 8 seconds, WhatsApp limit
      await execFileAsync('ffmpeg', [
        '-y',
        '-t', '8',
        '-i', inFile,
        '-vf', scaleFilter,
        '-loop', '0',
        '-vsync', '0',
        '-compression_level', '6',
        '-q:v', '50',
        '-an',
        outFile,
      ], { timeout: 60_000 });
    } else {
      // Static WebP
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', inFile,
        '-vf', scaleFilter,
        '-vframes', '1',
        '-compression_level', '6',
        '-q:v', '75',
        outFile,
      ], { timeout: 20_000 });
    }

    return fs.readFileSync(outFile);
  } finally {
    try { fs.unlinkSync(inFile);  } catch {}
    try { fs.unlinkSync(outFile); } catch {}
  }
}

async function handle({ sock, from, msg }) {
  const mediaInfo = getMediaTarget(msg);

  if (!mediaInfo) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to an image or video to make a sticker.*\n📌 Usage: *sticker (or *s)',
    });
  }

  // Fire-and-forget — never blocks the message loop
  setImmediate(async () => {
    try {
      let buf;
      try {
        buf = await downloadMediaMessage(
          mediaInfo.target, 'buffer', {},
          { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
        );
      } catch (_) {
        buf = await downloadMediaMessage(mediaInfo.target, 'buffer', {}, { logger: SLOG });
      }

      if (!buf || buf.length === 0) {
        return sock.sendMessage(from, {
          text: '❌ Could not download the media. It may have expired.',
        });
      }

      if (mediaInfo.isVideo && buf.length > MAX_VIDEO_BYTES) {
        return sock.sendMessage(from, {
          text: `❌ Video too large for sticker (max 20 MB).`,
        });
      }

      const webpBuf = await convertToSticker(buf, mediaInfo.isVideo);
      await sock.sendMessage(from, { sticker: webpBuf });
    } catch (e) {
      console.error('[Sticker]', e.message);
      const hint = e.message.includes('ENOENT')
        ? '\n\n⚠️ _ffmpeg not found — check nixpacks.toml has nixPkgs = ["ffmpeg"]_'
        : '';
      try {
        await sock.sendMessage(from, {
          text: `❌ Failed to create sticker: ${e.message}${hint}`,
        });
      } catch {}
    }
  });
}

module.exports = { handle };
