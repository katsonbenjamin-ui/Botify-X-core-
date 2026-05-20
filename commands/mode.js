'use strict';

const { getSessionOwnerMode, setSessionOwnerMode } = require('../utils/dataManager');

/**
 * *mode public  — Anyone in the session owner's group/DM can use commands
 * *mode private — Only the session owner can use commands
 *
 * Each linked user controls their own bot's visibility independently.
 * No admin restriction — every session owner can set their own mode.
 */
async function handle({ sock, from, args, sessionOwnerPhone }) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'public') {
    setSessionOwnerMode(sessionOwnerPhone, 'public');
    return sock.sendMessage(from, {
      text: `🌍 *Bot Mode: PUBLIC* ✅\n\nAnyone in your groups or DMs can now use bot commands.`,
    });
  }

  if (sub === 'private') {
    setSessionOwnerMode(sessionOwnerPhone, 'private');
    return sock.sendMessage(from, {
      text: `🔒 *Bot Mode: PRIVATE* ✅\n\nOnly you can use commands now. Everyone else is blocked.`,
    });
  }

  const cur = getSessionOwnerMode(sessionOwnerPhone);
  return sock.sendMessage(from, {
    text: `⚙️ *Bot Mode:* ${cur === 'public' ? '🌍 PUBLIC' : '🔒 PRIVATE'}\n\n📌 Usage:\n*mode public* — Open to everyone\n*mode private* — Only you`,
  });
}

module.exports = { handle };
