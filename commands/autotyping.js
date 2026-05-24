'use strict';

/**
 * *autotyping on/off — simulate typing before each bot reply.
 *
 * FIXES:
 *   • Proper 600–1400ms random delay (was dead / instant before)
 *   • Full composing → paused cycle
 *   • 100% fire-and-forget — NEVER blocks the runtime loop
 *   • Persistence: state.autotyping → dataManager → pgStore
 *
 * Usage pattern (called from events/messages.js before sending a reply):
 *   autotypingCmd.simulateTyping(sock, jid);   // fire-and-forget
 *   // then immediately run the command — no await
 */

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'on') {
    state.autotyping = true;
    return sock.sendMessage(from, {
      text: '⌨️ *Auto Typing Enabled!* ✅\n\nI will simulate typing before every reply.\n_Duration: 600–1400ms random_',
    });
  }

  if (sub === 'off') {
    state.autotyping = false;
    return sock.sendMessage(from, {
      text: '⌨️ *Auto Typing Disabled.* ❌',
    });
  }

  return sock.sendMessage(from, {
    text: `⌨️ *Auto Typing:* ${state.autotyping ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*autotyping on\n*autotyping off`,
  });
}

/**
 * Simulate typing in a chat.
 *
 * IMPORTANT: this function is fire-and-forget. It returns a Promise but
 * callers in messages.js must NOT await it — use setImmediate() or just
 * call without await so the message loop continues immediately.
 *
 * Pattern in messages.js:
 *   if (state.autotyping) simulateTyping(sock, from); // no await
 *
 * @param {object} sock - Baileys socket
 * @param {string} jid  - chat JID to type in
 */
async function simulateTyping(sock, jid) {
  try {
    const delay = 600 + Math.floor(Math.random() * 800); // 600–1400ms
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, delay));
    await sock.sendPresenceUpdate('paused', jid);
  } catch (_) {
    // Never propagate — typing errors must never crash the message loop
  }
}

module.exports = { handle, simulateTyping };
