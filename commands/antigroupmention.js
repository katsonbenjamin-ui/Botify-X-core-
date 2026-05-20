'use strict';

const { updateGroupSettings, getGroupSettings } = require('../utils/dataManager');

async function handle({ sock, from, args, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    updateGroupSettings(from, { antigroupmention: true });
    return sock.sendMessage(from, {
      text: `🔕 *Anti-Group Mention Enabled!* ✅\n\nStatus mentions in this group will be:\n• 🗑️ Automatically deleted\n• ⚠️ User warned (5 warnings = kick)`,
    });
  }
  if (sub === 'off') {
    updateGroupSettings(from, { antigroupmention: false });
    return sock.sendMessage(from, {
      text: `🔕 *Anti-Group Mention Disabled.* ❌\n\nStatus mentions are now allowed in this group.`,
    });
  }
  const cur = getGroupSettings(from).antigroupmention;
  return sock.sendMessage(from, {
    text: `🔕 *Anti-Group Mention Status:* ${cur ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*antigroupmention on — Enable\n*antigroupmention off — Disable`,
  });
}

module.exports = { handle };
