'use strict';

/**
 * *alwaysonline on  — Keep presence as "available" every 15 seconds.
 * *alwaysonline off — Stop keeping online.
 *
 * The actual timer is managed by a Proxy in sessionManager.js, so this
 * command only needs to toggle the flag — no timer code needed here.
 */
async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    state.alwaysonline = true;
    return sock.sendMessage(from, {
      text: `🟢 *Always Online Enabled!* ✅\n\nYour WhatsApp will appear *online 24/7* to others, even when your phone is inactive.`,
    });
  }
  if (sub === 'off') {
    state.alwaysonline = false;
    return sock.sendMessage(from, {
      text: `⚪ *Always Online Disabled.* ❌\n\nYour online status will now update normally based on your activity.`,
    });
  }
  return sock.sendMessage(from, {
    text: `🟢 *Always Online Status:* ${state.alwaysonline ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*alwaysonline on — Enable\n*alwaysonline off — Disable`,
  });
}

module.exports = { handle };
