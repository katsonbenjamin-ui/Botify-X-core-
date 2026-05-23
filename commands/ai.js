'use strict';

/**
 * *ai <prompt> — AI chat powered by OpenRouter or Groq.
 *
 * Env vars:
 *   AI_API_KEY   — required
 *   AI_PROVIDER  — "openrouter" (default) | "groq"
 *   AI_MODEL     — optional model override
 */

const https = require('https');

const PROVIDER = {
  openrouter: {
    host:  'openrouter.ai',
    path:  '/api/v1/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    extraHeaders: {
      'HTTP-Referer': 'https://botify-x.app',
      'X-Title':      'BOTIFY X',
    },
  },
  groq: {
    host:  'api.groq.com',
    path:  '/openai/v1/chat/completions',
    model: 'llama3-8b-8192',
    extraHeaders: {},
  },
};

const SYSTEM_PROMPT =
  'You are BOTIFY X, a smart, witty WhatsApp assistant. ' +
  'Be concise, direct, and helpful. Max 3 short paragraphs. No markdown headers.';

const TIMEOUT_MS   = 25_000;
const MAX_PROMPT   = 800;
const COOLDOWN_MS  = 5_000;

// Per-session queues & cooldowns (in-memory, lightweight)
const queues  = new Map();
const lastReq = new Map();

async function callAI(prompt) {
  const apiKey   = process.env.AI_API_KEY;
  if (!apiKey)   throw new Error('AI_API_KEY not configured');

  const providerKey = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
  const cfg = PROVIDER[providerKey] || PROVIDER.openrouter;
  const model = process.env.AI_MODEL || cfg.model;

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt.slice(0, MAX_PROMPT) },
    ],
    max_tokens:  400,
    temperature: 0.7,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => { req.destroy(); reject(new Error('AI request timed out')); },
      TIMEOUT_MS,
    );

    const req = https.request(
      {
        hostname: cfg.host,
        path:     cfg.path,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Authorization':  `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
          ...cfg.extraHeaders,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (d) => { raw += d; });
        res.on('end',  () => {
          clearTimeout(timer);
          try {
            const json = JSON.parse(raw);
            const text = json.choices?.[0]?.message?.content?.trim() || '';
            if (!text) reject(new Error('Empty AI response'));
            else resolve(text);
          } catch (e) { reject(new Error('AI parse error: ' + e.message)); }
        });
      },
    );

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

async function handle({ sock, from, argStr, sessionOwnerPhone }) {
  const prompt = (argStr || '').trim();
  if (!prompt) {
    return sock.sendMessage(from, { text: '❌ *Usage:* *ai <your question>' });
  }
  if (!process.env.AI_API_KEY) {
    return sock.sendMessage(from, {
      text: '⚙️ AI is not configured. Ask the bot owner to set *AI_API_KEY*.',
    });
  }

  // Per-session cooldown
  const now  = Date.now();
  const last = lastReq.get(sessionOwnerPhone) || 0;
  if (now - last < COOLDOWN_MS) {
    return sock.sendMessage(from, {
      text: `⏳ AI on cooldown. Wait ${Math.ceil((COOLDOWN_MS - (now - last)) / 1000)}s.`,
    });
  }
  lastReq.set(sessionOwnerPhone, now);

  // Serial queue per session — no concurrent AI calls
  const prev = queues.get(sessionOwnerPhone) || Promise.resolve();
  const task = prev.then(async () => {
    await sock.sendMessage(from, { text: '🤖 _Thinking..._' });
    try {
      const reply = await callAI(prompt);
      await sock.sendMessage(from, { text: `🤖 *BOTIFY AI*\n\n${reply}` });
    } catch (e) {
      console.error('[AI]', e.message);
      await sock.sendMessage(from, { text: `❌ AI error: ${e.message}` });
    }
  }).catch(() => {});

  queues.set(sessionOwnerPhone, task);
}

module.exports = { handle, callAI };
