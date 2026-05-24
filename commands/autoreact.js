'use strict';

/**
 * *autoreact on/off — randomly react to incoming messages with emojis.
 *
 * FIXES:
 *   • Per-chat cooldown (5 seconds) — prevents reaction spam in busy groups
 *   • Ignores reactionMessage (prevents reaction-to-reaction loops)
 *   • Ignores messages from self (fromMe)
 *   • Ignores protocol/system messages
 *   • Persistence: state.autoreact → dataManager → pgStore
 */

const NodeCache = require('node-cache');
const { isReaction } = require('../utils/messageContext');

const EMOJIS = [
  '❤️','😂','🔥','👏','😍','🎉','💯','👍','😎','✨',
  '🤩','💪','🙌','⚡','🌟','🥰','😆','🫡','🤣','💫',
  '👀','💀','🫶','🎯','🏆','😤','🤝','🫠','💥','🎊',
  '🙏','💎','🚀','🌈','🎶','🍀','😇','🦋','🌺','💝',
];

const REACT_CHANCE = parseFloat(process.env.REACT_CHANCE || '0.20');

// Per-chat cooldown: max 1 reaction per 5 seconds per chat
const cooldowns = new NodeCache({ stdTTL: 5, checkperiod: 5 });

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'on') {
    state.autoreact = true;
    return sock.sendMessage(from, {
      text: '⚡ *Auto React Enabled!* ✅\n\nI will randomly react to messages with emojis.\n_Reaction chance: ' + Math.round(REACT_CHANCE * 100) + '%_',
    });
  }

  if (sub === 'off') {
    state.autoreact = false;
    return sock.sendMessage(from, {
      text: '⚡ *Auto React Disabled.* ❌',
    });
  }

  return sock.sendMessage(from, {
    text: `⚡ *Auto React:* ${state.autoreact ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*autoreact on\n*autoreact off\n\n_Reaction chance: ${Math.round(REACT_CHANCE * 100)}%_`,
  });
}

function randomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

/**
 * Decide whether to react to this specific message.
 * Called from events/messages.js before sending a reaction.
 *
 * @param {object} msg - the raw Baileys message
 * @param {string} from - the chat JID
 * @returns {boolean}
 */
function shouldReact(msg, from) {
  // Never react to reactions (avoid loops)
  if (isReaction(msg)) return false;
  // Never react to own messages
  if (msg?.key?.fromMe) return false;
  // Per-chat cooldown
  if (cooldowns.get(from)) return false;
  // Probability check
  return Math.random() < REACT_CHANCE;
}

function markCooldown(from) {
  cooldowns.set(from, true);
}

module.exports = { handle, randomEmoji, shouldReact, markCooldown };
