'use strict';

/**
 * *tagall [message]
 * Tags every member in the group, one per line in a clean ┃ format.
 */
async function handle({ sock, from, argStr, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  try {
    const meta    = await sock.groupMetadata(from);
    const members = meta.participants.map(p => p.id);

    const header = argStr
      ? `┏▣ ◈ ATTENTION ◈\n┃ 📣 ${argStr}\n┗▣\n`
      : `┏▣ ◈ ATTENTION ◈\n┃ 📣 Attention everyone!\n┗▣\n`;

    const lines = members
      .map(m => `┃ @${m.split('@')[0]}`)
      .join('\n');

    await sock.sendMessage(from, {
      text: `${header}\n${lines}`,
      mentions: members,
    });
  } catch (e) {
    console.error('[Tagall]', e.message);
    await sock.sendMessage(from, { text: '❌ *Failed.* Make sure the bot is a group admin.' });
  }
}

module.exports = { handle };
