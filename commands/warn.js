'use strict';

const { addWarning, resetWarnings } = require('../utils/dataManager');

async function handle({ sock, from, msg, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) {
    return sock.sendMessage(from, {
      text: '❌ *No user specified.*\nReply to a message or @mention someone to warn.\n\n📌 Usage: *warn',
    });
  }

  const phone = target.split('@')[0].split(':')[0];
  const count = addWarning(from, phone);

  if (count >= 5) {
    await sock.sendMessage(from, {
      text: `🚨 *Warning 5/5!*\n\n@${phone} has reached the maximum warnings and will be *removed* from the group!`,
      mentions: [target],
    });
    try { await sock.groupParticipantsUpdate(from, [target], 'remove'); } catch {}
    resetWarnings(from, phone);
  } else {
    await sock.sendMessage(from, {
      text: `⚠️ *Warning ${count}/5* issued to @${phone}.\n\n${5 - count} more warning(s) before automatic removal.`,
      mentions: [target],
    });
  }
}

module.exports = { handle };
