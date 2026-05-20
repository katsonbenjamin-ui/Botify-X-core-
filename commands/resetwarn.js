'use strict';

const { resetWarnings, getWarningCount } = require('../utils/dataManager');

/**
 * *resetwarn — clears all warnings for a user in the current group.
 * Reply to their message or @mention them.
 */
async function handle({ sock, from, msg, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) {
    return sock.sendMessage(from, {
      text: '❌ *No user specified.*\nReply to a message or @mention someone to reset their warnings.\n\n📌 Usage: *resetwarn',
    });
  }

  const phone = target.split('@')[0].split(':')[0];
  const count = getWarningCount(from, phone);

  if (count === 0) {
    return sock.sendMessage(from, {
      text: `ℹ️ @${phone} has no active warnings to reset.`,
      mentions: [target],
    });
  }

  resetWarnings(from, phone);

  return sock.sendMessage(from, {
    text: `✅ *Warnings Cleared!*\n\nAll *${count}* warning(s) for @${phone} have been reset to 0. 🧹`,
    mentions: [target],
  });
}

module.exports = { handle };
