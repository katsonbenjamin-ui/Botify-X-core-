'use strict';

async function handle({ sock, from }) {
  try {
    const list = await sock.fetchBlocklist();
    if (!list || list.length === 0) {
      return sock.sendMessage(from, { text: '✅ *Your block list is empty.*' });
    }
    const lines = list.map((jid, i) => `${i + 1}. +${jid.split('@')[0]}`).join('\n');
    return sock.sendMessage(from, {
      text: `🚫 *Blocked Contacts (${list.length}):*\n\n${lines}\n\n📌 Use *unblock to remove someone.`,
    });
  } catch (e) {
    console.error('[ListBlocked]', e.message);
    return sock.sendMessage(from, { text: '❌ Failed to fetch block list. Please try again.' });
  }
}

module.exports = { handle };
