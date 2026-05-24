'use strict';

/**
 * *summary — AI-powered recap of recent group messages.
 *
 * FIX:
 *   • AI call is fire-and-forget (doesn't block the message loop)
 *   • Explicit 25s timeout wrapper with abort on hang
 *   • Always replies — never silently fails
 *   • Fallback stats summary when AI_API_KEY is not set
 *   • Better error logging for provider failures
 */

const msgBuffer = require('../utils/msgBuffer');
const { callAI } = require('./ai');

const MAX_MSGS  = 80;
const MAX_CHARS = 2500;
const AI_TIMEOUT_MS = 25_000;

async function handle({ sock, from, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  const msgs = msgBuffer.get(from).slice(-MAX_MSGS);

  if (msgs.length < 5) {
    return sock.sendMessage(from, {
      text: '📋 *Summary*\n\n_Not enough recent messages (need at least 5). Keep chatting!_',
    });
  }

  await sock.sendMessage(from, { text: '📋 _Analysing recent messages..._' });

  // Fire-and-forget: AI can take up to 25s — don't block the loop
  setImmediate(async () => {
    try {
      // Fallback when no AI key: basic stats
      if (!process.env.AI_API_KEY) {
        const senders = new Set(msgs.map(m => m.sender));
        return sock.sendMessage(from, {
          text: [
            '┏▣ ◈ GROUP SUMMARY ◈',
            `┃ 📨 Messages: ${msgs.length}`,
            `┃ 👥 Participants: ${senders.size}`,
            `┃ 🕐 Period: last ${msgs.length} messages`,
            '┃',
            '┃ _Set AI_API_KEY for smart AI summaries._',
            '┗▣',
          ].join('\n'),
        });
      }

      // Build transcript (cap at MAX_CHARS to stay within token budget)
      let transcript = '';
      for (const m of msgs) {
        const line = `+${m.sender}: ${m.body}\n`;
        if (transcript.length + line.length > MAX_CHARS) break;
        transcript += line;
      }

      const aiPrompt =
        'Below is a WhatsApp group conversation. Write a concise bullet-point summary ' +
        '(max 6 bullets, plain text, no markdown headers, no phone numbers) ' +
        'of the main topics discussed:\n\n' + transcript;

      // Explicit timeout race so a hanging AI provider never leaves the user waiting
      const summary = await Promise.race([
        callAI(aiPrompt),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('AI summary timed out after 25s')), AI_TIMEOUT_MS),
        ),
      ]);

      await sock.sendMessage(from, {
        text: [
          '┏▣ ◈ GROUP SUMMARY ◈',
          `┃ _Last ${msgs.length} messages_`,
          '┃',
          ...summary.split('\n').map(l => `┃ ${l}`),
          '┗▣',
        ].join('\n'),
      });
    } catch (e) {
      console.error('[Summary] Error:', e.message);
      try {
        await sock.sendMessage(from, {
          text: `❌ Summary failed: ${e.message}`,
        });
      } catch {}
    }
  });
}

module.exports = { handle };
