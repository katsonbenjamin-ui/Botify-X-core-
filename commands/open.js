'use strict';

async function handle({ sock, from, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  try {
    await sock.groupSettingUpdate(from, 'not_announcement');
    return sock.sendMessage(from, {
      text: `🔓 *Group Opened!* ✅\n\nAll members can now send messages.`,
    });
  } catch (e) {
    console.error('[Open]', e.message);
    return sock.sendMessage(from, {
      text: '❌ Failed to open group. Make sure the bot is a group admin.',
    });
  }
}

module.exports = { handle };
