'use strict';

const { resetGroupMsgCounts } = require('../utils/dataManager');

/**
 * *resetcount — clears the message activity leaderboard for this group.
 * Resets both the in-memory (current session) and persistent (file) counts.
 * Admin/owner only.
 */
async function handle({ sock, from, isGroup, isAdmin, sessionMsgCounts }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  if (!isAdmin) {
    return sock.sendMessage(from, { text: '❌ *Only the bot admin can reset message counts.*' });
  }

  // Clear in-memory counts for this group
  if (sessionMsgCounts?.has(from)) {
    sessionMsgCounts.get(from).clear();
  }

  // Clear persistent counts from file
  resetGroupMsgCounts(from);

  await sock.sendMessage(from, {
    text: `┏▣ ◈ RESET COMPLETE ◈\n┃\n┃ ✅ Message activity for this\n┃ group has been cleared.\n┃\n┃ *listactive will start fresh.\n┗▣`,
  });
}

module.exports = { handle };
