'use strict';

async function handle({ sock, from, msg, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) {
    return sock.sendMessage(from, {
      text: '❌ *No user specified.*\nReply to a message or @mention someone to kick.\n\n📌 Usage: *kick',
    });
  }
  try {
    await sock.groupParticipantsUpdate(from, [target], 'remove');
    await sock.sendMessage(from, {
      text: `👢 *Member Removed.*\n\n@${target.split('@')[0]} has been kicked from the group.`,
      mentions: [target],
    });
  } catch {
    await sock.sendMessage(from, {
      text: '❌ *Failed to remove member.* Make sure the bot is a group admin and try again.',
    });
  }
}

module.exports = { handle };
