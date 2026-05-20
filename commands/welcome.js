'use strict';

const { updateGroupSettings, getGroupSettings } = require('../utils/dataManager');

async function handle({ sock, from, args, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    updateGroupSettings(from, { welcome: true });
    return sock.sendMessage(from, {
      text: `👋 *Welcome Messages Enabled!* ✅\n\nNew members will receive a warm welcome when they join. 🎉`,
    });
  }
  if (sub === 'off') {
    updateGroupSettings(from, { welcome: false });
    return sock.sendMessage(from, {
      text: `👋 *Welcome Messages Disabled.* ❌\n\nNew members will no longer receive a welcome message.`,
    });
  }
  const cur = getGroupSettings(from).welcome;
  return sock.sendMessage(from, {
    text: `👋 *Welcome Status:* ${cur ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*welcome on — Enable\n*welcome off — Disable`,
  });
}

module.exports = { handle };
