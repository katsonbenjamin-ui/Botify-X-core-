'use strict';

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    state.antidelete = true;
    return sock.sendMessage(from, {
      text: `🗑️ *Antidelete Enabled!* ✅\n\nDeleted messages in your chats and groups will be revealed automatically.`,
    });
  }
  if (sub === 'off') {
    state.antidelete = false;
    return sock.sendMessage(from, {
      text: `🗑️ *Antidelete Disabled.* ❌\n\nDeleted messages will no longer be tracked.`,
    });
  }
  return sock.sendMessage(from, {
    text: `🗑️ *Antidelete Status:* ${state.antidelete ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*antidelete on — Enable\n*antidelete off — Disable`,
  });
}

module.exports = { handle };
