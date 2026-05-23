'use strict';

/**
 * *tomp3 — extract audio from a video or convert voice/audio → MP3.
 * Reply to a video, audio, or voice message with *tomp3.
 *
 * ffmpeg-based. Oracle ARM compatible. Max 50 MB input protection.
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

const MAX_SIZE_MB = 50;

function tmpPath(ext) {
  return path.join(os.tmpdir(), 'tomp3_' + crypto.randomBytes(8).toString('hex') + ext);
}

async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const m   = msg.message || {};

  const directVid = m.videoMessage;
  const directAud = m.audioMessage;
  const quotedVid = ctx?.quotedMessage?.videoMessage;
  const quotedAud = ctx?.quotedMessage?.audioMessage;

  const isVideo = !!(directVid || quotedVid);
  const isAudio = !!(directAud || quotedAud);

  if (!isVideo && !isAudio) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a video or audio message to convert it to MP3.*\n📌 Usage: *tomp3',
    });
  }

  try {
    let target;
    if (directVid || directAud) {
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

    await sock.sendMessage(from, { text: '🎵 _Converting to MP3..._' });

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
      return sock.sendMessage(from, { text: '❌ Could not download media. It may have expired.' });
    }

    // File size guard
    if (buf.length > MAX_SIZE_MB * 1024 * 1024) {
      return sock.sendMessage(from, {
        text: `❌ File too large (max ${MAX_SIZE_MB} MB).`,
      });
    }

    const inExt  = isVideo ? '.mp4' : '.ogg';
    const inFile  = tmpPath(inExt);
    const outFile = tmpPath('.mp3');

    try {
      fs.writeFileSync(inFile, buf);
      await execFileAsync('ffmpeg', [
        '-y', '-i', inFile,
        '-vn',                     // no video
        '-acodec', 'libmp3lame',
        '-q:a', '4',               // ~130 kbps VBR
        '-ar', '44100',
        outFile,
      ], { timeout: 60_000 });

      const mp3 = fs.readFileSync(outFile);
      await sock.sendMessage(from, {
        audio:    mp3,
        mimetype: 'audio/mpeg',
        ptt:      false,
      });
    } finally {
      try { fs.unlinkSync(inFile);  } catch {}
      try { fs.unlinkSync(outFile); } catch {}
    }
  } catch (e) {
    console.error('[ToMp3]', e.message);
    await sock.sendMessage(from, { text: `❌ Conversion failed: ${e.message}` });
  }
}

module.exports = { handle };
