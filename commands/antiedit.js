'use strict';

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    state.antiedit = true;
    return sock.sendMessage(from, {
      text: `✏️ *Antiedit Enabled!* ✅\n\nWhen someone edits a message, both the *original* and *edited* versions will be shown.`,
    });
  }
  if (sub === 'off') {
    state.antiedit = false;
    return sock.sendMessage(from, {
      text: `✏️ *Antiedit Disabled.* ❌\n\nMessage edits will no longer be tracked.`,
    });
  }
  return sock.sendMessage(from, {
    text: `✏️ *Antiedit Status:* ${state.antiedit ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*antiedit on — Enable\n*antiedit off — Disable`,
  });
}

module.exports = { handle };
