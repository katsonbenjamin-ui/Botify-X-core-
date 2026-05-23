'use strict';

/**
 * *summary — summarize recent group messages using AI.
 * Uses the in-memory msgBuffer populated by events/messages.js.
 * Falls back to a simple word-count summary if AI is not configured.
 */

const msgBuffer = require('../utils/msgBuffer');
const { callAI } = require('./ai');

const MAX_MSGS   = 80;   // messages to feed into summary
const MAX_CHARS  = 2500; // token budget (chars) for message content

async function handle({ sock, from, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  const msgs = msgBuffer.get(from).slice(-MAX_MSGS);

  if (msgs.length < 5) {
    return sock.sendMessage(from, {
      text: '📋 *Summary*\n\nNot enough recent messages to summarize yet. (Need at least 5)',
    });
  }

  // Build transcript
  let transcript = '';
  for (const m of msgs) {
    const line = `+${m.sender}: ${m.body}\n`;
    if (transcript.length + line.length > MAX_CHARS) break;
    transcript += line;
  }

  await sock.sendMessage(from, { text: '📋 _Analyzing recent messages..._' });

  try {
    if (!process.env.AI_API_KEY) {
      // Fallback: simple stats without AI
      const senders = new Set(msgs.map(m => m.sender));
      return sock.sendMessage(from, {
        text: [
          '┏▣ ◈ GROUP SUMMARY ◈',
          `┃ 📨 Messages: ${msgs.length}`,
          `┃ 👥 Participants: ${senders.size}`,
          `┃ 🕐 Period: last ${msgs.length} messages`,
          '┃',
          '┃ _Set AI_API_KEY for smart summaries._',
          '┗▣',
        ].join('\n'),
      });
    }

    const aiPrompt =
      'Below is a WhatsApp group conversation. Write a short, bullet-point summary ' +
      '(max 6 bullets) of what was discussed. Be concise. Do not include phone numbers.\n\n' +
      transcript;

    const summary = await callAI(aiPrompt);

    await sock.sendMessage(from, {
      text: `┏▣ ◈ GROUP SUMMARY ◈\n┃ _Last ${msgs.length} messages_\n┃\n${
        summary.split('\n').map(l => `┃ ${l}`).join('\n')
      }\n┗▣`,
    });
  } catch (e) {
    console.error('[Summary]', e.message);
    await sock.sendMessage(from, { text: `❌ Summary failed: ${e.message}` });
  }
}

module.exports = { handle };
