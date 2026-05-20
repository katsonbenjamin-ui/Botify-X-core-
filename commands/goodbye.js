'use strict';

const { updateGroupSettings, getGroupSettings } = require('../utils/dataManager');

async function handle({ sock, from, args, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    updateGroupSettings(from, { goodbye: true });
    return sock.sendMessage(from, {
      text: `👋 *Goodbye Messages Enabled!* ✅\n\nWhen members leave or are removed, a goodbye message will be sent.`,
    });
  }
  if (sub === 'off') {
    updateGroupSettings(from, { goodbye: false });
    return sock.sendMessage(from, {
      text: `👋 *Goodbye Messages Disabled.* ❌\n\nThe bot will no longer send goodbye messages.`,
    });
  }
  const cur = getGroupSettings(from).goodbye;
  return sock.sendMessage(from, {
    text: `👋 *Goodbye Status:* ${cur ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*goodbye on — Enable\n*goodbye off — Disable`,
  });
}

module.exports = { handle };
