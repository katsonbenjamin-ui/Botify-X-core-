'use strict';

const { getGroupSettings } = require('../utils/dataManager');

async function handleGroupParticipants({ session, payload }) {
  const sock   = session.sock;
  const events = Array.isArray(payload) ? payload : [payload];

  for (const ev of events) {
    try {
      const { id: gid, participants, action } = ev;
      const s = getGroupSettings(gid);

      if (action === 'add' && s.welcome) {
        for (const jid of participants) {
          await sock.sendMessage(gid, {
            text: `🎉 *Welcome to the group!* 🎉\n\n👋 Hey @${jid.split('@')[0]}, we're glad to have you here!\nFeel free to say hi. 😊`,
            mentions: [jid],
          });
        }
      } else if (action === 'remove' && s.goodbye) {
        for (const jid of participants) {
          await sock.sendMessage(gid, {
            text: `👋 *Goodbye @${jid.split('@')[0]}!*\nWe'll miss you. Take care and all the best! 🙏`,
            mentions: [jid],
          });
        }
      }
    } catch (e) { console.error('[GroupUpdate]', e.message); }
  }
}

module.exports = { handleGroupParticipants };
