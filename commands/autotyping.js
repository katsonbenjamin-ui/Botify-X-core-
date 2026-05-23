'use strict';

/**
 * *autotyping on/off — show a realistic typing indicator before each bot reply.
 *
 * When enabled, the bot sends a "composing" presence update before dispatching
 * any command response, making it feel more human-like.
 *
 * Delay: 600–1400ms randomized (non-blocking, does not lag the runtime loop).
 * Persistence: state.autotyping saved via dataManager → pgStore.
 */

const MIN_DELAY_MS = 600;
const MAX_DELAY_MS = 1400;

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'on') {
    state.autotyping = true;
    return sock.sendMessage(from, {
      text: '⌨️ *Auto Typing Enabled!* ✅\n\nI will show a typing indicator before every reply.',
    });
  }

  if (sub === 'off') {
    state.autotyping = false;
    return sock.sendMessage(from, {
      text: '⌨️ *Auto Typing Disabled.* ❌',
    });
  }

  return sock.sendMessage(from, {
    text: `⌨️ *Auto Typing:* ${state.autotyping ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*autotyping on — Enable\n*autotyping off — Disable`,
  });
}

/**
 * Simulate typing before a command reply.
 * Called from messages.js before dispatching commands when state.autotyping is true.
 *
 * @param {object} sock  - Baileys socket
 * @param {string} from  - chat JID
 */
async function simulateTyping(sock, from) {
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  try {
    await sock.sendPresenceUpdate('composing', from);
    await new Promise(r => setTimeout(r, delay));
    await sock.sendPresenceUpdate('paused', from);
  } catch (_) {}
}

module.exports = { handle, simulateTyping };
