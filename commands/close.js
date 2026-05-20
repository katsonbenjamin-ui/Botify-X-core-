'use strict';

async function handle({ sock, from, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  try {
    await sock.groupSettingUpdate(from, 'announcement');
    return sock.sendMessage(from, {
      text: `🔒 *Group Closed!* ✅\n\nOnly admins can send messages now.`,
    });
  } catch (e) {
    console.error('[Close]', e.message);
    return sock.sendMessage(from, {
      text: '❌ Failed to close group. Make sure the bot is a group admin.',
    });
  }
}

module.exports = { handle };
