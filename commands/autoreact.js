'use strict';

/**
 * *autoreact on/off — automatically react to incoming messages with random emojis.
 *
 * Persistence: state.autoreact is saved via dataManager → pgStore.
 * Reaction probability: 20% per message (configurable via REACT_CHANCE env var).
 */

const EMOJIS = [
  '❤️','😂','🔥','👏','😍','🎉','💯','👍','😎','✨',
  '🤩','💪','🙌','⚡','🌟','🥰','😆','🫡','🤣','💫',
  '👀','💀','🫶','🎯','🏆','😤','🤝','🫠','💥','🎊',
];

const REACT_CHANCE = parseFloat(process.env.REACT_CHANCE || '0.20');

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'on') {
    state.autoreact = true;
    return sock.sendMessage(from, {
      text: '⚡ *Auto React Enabled!* ✅\n\nI will randomly react to messages with emojis.',
    });
  }

  if (sub === 'off') {
    state.autoreact = false;
    return sock.sendMessage(from, {
      text: '⚡ *Auto React Disabled.* ❌\n\nAuto reactions are now off.',
    });
  }

  return sock.sendMessage(from, {
    text: `⚡ *Auto React:* ${state.autoreact ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*autoreact on — Enable\n*autoreact off — Disable`,
  });
}

function randomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function shouldReact() {
  return Math.random() < REACT_CHANCE;
}

module.exports = { handle, randomEmoji, shouldReact };
