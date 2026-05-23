'use strict';

/**
 * *tts <text> — text-to-speech.
 * Uses StreamElements TTS API (Brian voice, no API key needed).
 * Sends output as an audio message.
 *
 * Usage: *tts Hello, how are you?
 *
 * Max 200 characters to keep it fast and lightweight.
 */

const https = require('https');

const MAX_CHARS  = 200;
const VOICE      = process.env.TTS_VOICE || 'Brian';
const TIMEOUT_MS = 15_000;

function fetchTTS(text) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text.slice(0, MAX_CHARS));
    const options = {
      hostname: 'api.streamelements.com',
      path:     `/kappa/v2/speech?voice=${VOICE}&text=${encoded}`,
      method:   'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept':     'audio/mpeg',
      },
    };

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('TTS request timed out'));
    }, TIMEOUT_MS);

    const chunks = [];
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        reject(new Error(`TTS API returned ${res.statusCode}`));
        res.resume();
        return;
      }
      res.on('data',  (c) => chunks.push(c));
      res.on('end',   () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

async function handle({ sock, from, argStr }) {
  const text = (argStr || '').trim();
  if (!text) {
    return sock.sendMessage(from, {
      text: '❌ *Usage:* *tts <text to speak>\n📌 Max 200 characters.',
    });
  }

  if (text.length > MAX_CHARS) {
    return sock.sendMessage(from, {
      text: `❌ Text too long. Max ${MAX_CHARS} characters (yours: ${text.length}).`,
    });
  }

  try {
    const audioBuf = await fetchTTS(text);
    await sock.sendMessage(from, {
      audio:    audioBuf,
      mimetype: 'audio/mpeg',
      ptt:      false,
    });
  } catch (e) {
    console.error('[TTS]', e.message);
    await sock.sendMessage(from, { text: `❌ TTS failed: ${e.message}` });
  }
}

module.exports = { handle };
