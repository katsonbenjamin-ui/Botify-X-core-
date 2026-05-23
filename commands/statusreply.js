'use strict';

/**
 * *statusreply on/off — auto-reply to statuses viewed by the linked account.
 *
 * When enabled, whenever a status from any contact arrives (status@broadcast),
 * the bot sends one of the configured replies directly to that contact.
 *
 * Cooldown: 5 minutes per contact to prevent spam.
 * Persistence: state.statusreply saved via dataManager → pgStore.
 */

const NodeCache = require('node-cache');

// 5-minute cooldown per contact JID
const cooldowns = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const DEFAULT_REPLIES = [
  '🔥',
  '👀',
  '❤️',
  '😍 Nice status!',
  '🌟',
  '💯',
  '👏',
  '🤩',
];

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'on') {
    state.statusreply = true;
    return sock.sendMessage(from, {
      text: '👁️ *Status Reply Enabled!* ✅\n\nI will automatically reply to statuses I view.\n_Cooldown: 5 min per contact._',
    });
  }

  if (sub === 'off') {
    state.statusreply = false;
    return sock.sendMessage(from, {
      text: '👁️ *Status Reply Disabled.* ❌',
    });
  }

  return sock.sendMessage(from, {
    text: `👁️ *Status Reply:* ${state.statusreply ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*statusreply on — Enable\n*statusreply off — Disable`,
  });
}

/**
 * Called from messages.js when a status@broadcast message is received.
 * @param {object} sock
 * @param {object} msg  - the status message
 * @param {object} state - session state
 */
async function handleAutoReply(sock, msg, state) {
  if (!state?.statusreply) return;
  if (msg.key.fromMe)       return;

  // The status poster's JID is in key.participant
  const posterJid = msg.key.participant || msg.key.remoteJid;
  if (!posterJid || posterJid === 'status@broadcast') return;

  // Cooldown check
  if (cooldowns.get(posterJid)) return;
  cooldowns.set(posterJid, true);

  try {
    const replies = process.env.STATUS_REPLIES
      ? process.env.STATUS_REPLIES.split('|')
      : DEFAULT_REPLIES;

    const reply = replies[Math.floor(Math.random() * replies.length)];

    await sock.sendMessage(posterJid, { text: reply });
  } catch (e) {
    console.error('[StatusReply]', e.message);
  }
}

module.exports = { handle, handleAutoReply };
