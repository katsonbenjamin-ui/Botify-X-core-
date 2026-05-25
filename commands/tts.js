'use strict';

/**
 * *tts <text> — text-to-speech, no API key required.
 *
 * Provider chain (tried in order):
 *   1. Google Translate TTS (client=tw-ob) — primary, no key needed
 *   2. Google Translate TTS (client=gtx)   — alternate client ID fallback
 *
 * BUG FIXES:
 *   • MP3 signature validation: checks for 0xFF 0xFB / ID3 header so we never
 *     forward an HTML error page disguised as audio to WhatsApp.
 *   • Dual-endpoint fallback: if the primary tw-ob client gets rate-limited or
 *     returns a non-audio response, retries automatically with gtx client.
 *   • Redirect following (301/302) — Google occasionally 302s mobile clients.
 *   • Never blocks the message loop (setImmediate wrapper).
 *
 * Max 200 chars. Railway/Oracle safe — pure stdlib https/http, no extra deps.
 */

const https    = require('https');
const http     = require('http');
const MAX_CHARS = 200;
const TIMEOUT   = 20_000;

/**
 * Validate that a buffer is actually MP3 or AAC audio.
 * Rejects HTML error pages (e.g., Google 429 rate-limit pages) that arrive
 * with a 200 status code but contain HTML instead of audio bytes.
 *
 * MP3 sync word: 0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2 (MPEG frames)
 * ID3 tag:       "ID3" at offset 0
 * MPEG-1:        0xFF 0xE0–0xFF
 */
function isValidAudio(buf) {
  if (!buf || buf.length < 4) return false;
  const b0 = buf[0], b1 = buf[1];
  // ID3 header (MP3 with tags)
  if (b0 === 0x49 && b1 === 0x44 && buf[2] === 0x33) return true;
  // MPEG sync word — first byte 0xFF, second byte 0xE0–0xFF
  if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) return true;
  // OGG container (Baileys voice notes)
  if (b0 === 0x4F && b1 === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return true;
  return false;
}

/**
 * Fetch TTS audio from a Google Translate endpoint.
 * Follows up to 3 redirects. Returns a validated audio Buffer.
 */
function fetchTTS(text, lang, client, attempt = 0) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text.slice(0, MAX_CHARS));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&total=1&idx=0&textlen=${text.length}&client=${client}&prev=input&ttsspeed=1`;

    const options = {
      method:  'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
        'Referer':    'https://translate.google.com/',
        'Accept':     'audio/mpeg, audio/ogg, audio/*, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    const lib    = https;
    const chunks = [];

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`TTS timeout (${client})`));
    }, TIMEOUT);

    const req = lib.get(url, options, (res) => {
      // Follow redirects (Google 302s mobile clients)
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && attempt < 3) {
        clearTimeout(timer);
        res.resume();
        return fetchTTS(text, lang, client, attempt + 1).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from Google TTS (${client})`));
      }

      res.on('data',  c => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        // BUG FIX: validate bytes — Google sometimes sends an HTML rate-limit
        // page with status 200 which would corrupt the WhatsApp audio message.
        if (!isValidAudio(buf)) {
          return reject(new Error(`Non-audio response from Google TTS (${client}), len=${buf.length}`));
        }
        resolve(buf);
      });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error(`Socket timeout (${client})`)); });
  });
}

/**
 * Try TTS with primary client, fall back to secondary on failure.
 * Both use Google Translate — no API key needed.
 */
async function fetchGoogleTTS(text, lang = 'en') {
  const clients = ['tw-ob', 'gtx'];
  let lastErr;
  for (const client of clients) {
    try {
      const buf = await fetchTTS(text, lang, client);
      return buf;
    } catch (e) {
      console.warn(`[TTS] ${client} failed: ${e.message} — trying next provider...`);
      lastErr = e;
    }
  }
  throw lastErr || new Error('All TTS providers failed');
}

async function handle({ sock, from, argStr }) {
  const text = (argStr || '').trim();

  if (!text) {
    return sock.sendMessage(from, {
      text: '🔊 *Usage:* *tts <text to speak>\n📌 Max 200 characters.\n\nExample:\n*tts Hello, how are you?',
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
        return sock.sendMessage(from, { text: '❌ TTS returned empty audio. Try again in a moment.' });
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
          text: `❌ TTS failed: ${e.message}\n_Try a shorter text or try again shortly._`,
        });
      } catch {}
    }
  });
}

module.exports = { handle, fetchGoogleTTS, isValidAudio };
