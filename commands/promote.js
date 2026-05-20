'use strict';

async function handle({ sock, from, msg, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) {
    return sock.sendMessage(from, {
      text: '❌ *No user specified.*\nReply to a message or @mention someone to promote.\n\n📌 Usage: *promote',
    });
  }
  try {
    await sock.groupParticipantsUpdate(from, [target], 'promote');
    await sock.sendMessage(from, {
      text: `👑 *Promotion Successful!*\n\n@${target.split('@')[0]} is now a *group admin*. Congratulations! 🎉`,
      mentions: [target],
    });
  } catch {
    await sock.sendMessage(from, {
      text: '❌ *Failed to promote.* Make sure the bot is a group admin and try again.',
    });
  }
}

module.exports = { handle };
