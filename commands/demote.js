'use strict';

async function handle({ sock, from, msg, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) {
    return sock.sendMessage(from, {
      text: '❌ *No user specified.*\nReply to a message or @mention someone to demote.\n\n📌 Usage: *demote',
    });
  }
  try {
    await sock.groupParticipantsUpdate(from, [target], 'demote');
    await sock.sendMessage(from, {
      text: `⬇️ *Demotion Successful.*\n\n@${target.split('@')[0]} has been removed from admin role.`,
      mentions: [target],
    });
  } catch {
    await sock.sendMessage(from, {
      text: '❌ *Failed to demote.* Make sure the bot is a group admin and try again.',
    });
  }
}

module.exports = { handle };
