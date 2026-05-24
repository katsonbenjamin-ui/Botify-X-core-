'use strict';

/**
 * *tts <text> — text-to-speech, no API key required.
 *
 * Provider: Google Translate TTS (same backend as google-tts-api npm package).
 * No API key. No account. Railway-safe. Returns MP3 audio.
 *
 * Max 200 chars. Fire-and-forget so the message loop never blocks.
 */

const https    = require('https');
const http     = require('http');
const MAX_CHARS = 200;
const TIMEOUT   = 20_000;

/**
 * Fetch TTS audio from Google Translate.
 * Returns a Buffer of MP3 audio.
 * Follows up to 3 redirects (Google sometimes 302s).
 */
function fetchGoogleTTS(text, lang = 'en', attempt = 0) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text.slice(0, MAX_CHARS));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&total=1&idx=0&textlen=${text.length}&client=tw-ob&prev=input&ttsspeed=1`;

    const options = {
      method:  'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':    'https://translate.google.com/',
        'Accept':     'audio/mpeg, audio/*, */*',
      },
    };

    const lib = url.startsWith('https') ? https : http;
    const chunks = [];

    const timer = setTimeout(() => { req.destroy(); reject(new Error('TTS request timed out')); }, TIMEOUT);

    const req = lib.get(url, options, (res) => {
      // Follow redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && attempt < 3) {
        clearTimeout(timer);
        res.resume();
        return fetchGoogleTTS(text, lang, attempt + 1).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.resume();
        return reject(new Error(`TTS returned HTTP ${res.statusCode}`));
      }

      res.on('data',  c => chunks.push(c));
      res.on('end',   () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error('TTS socket timeout')); });
  });
}

async function handle({ sock, from, argStr }) {
  const text = (argStr || '').trim();

  if (!text) {
    return sock.sendMessage(from, {
      text: '🔊 *Usage:* *tts <text to speak>\n📌 Max 200 characters. Example:\n*tts Hello, how are you?',
    });
  }

  if (text.length > MAX_CHARS) {
    return sock.sendMessage(from, {
      text: `❌ Too long (${text.length} chars). Max is ${MAX_CHARS} characters.`,
    });
  }

  // Fire-and-forget — never blocks the message loop
  setImmediate(async () => {
    try {
      const audioBuf = await fetchGoogleTTS(text);

      if (!audioBuf || audioBuf.length === 0) {
        return sock.sendMessage(from, { text: '❌ TTS returned empty audio.' });
      }

      await sock.sendMessage(from, {
        audio:    audioBuf,
        mimetype: 'audio/mpeg',
        ptt:      false,
      });
    } catch (e) {
      console.error('[TTS]', e.message);
      try {
        await sock.sendMessage(from, {
          text: `❌ TTS failed: ${e.message}\n_Try a shorter text or try again in a moment._`,
        });
      } catch {}
    }
  });
}

module.exports = { handle };
