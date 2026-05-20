'use strict';

/**
 * *approve [number]
 * Approves a pending group join request by index (1-based).
 * Run *approve with no number to list pending requests.
 */
async function handle({ sock, from, args, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  try {
    const requests = await sock.groupRequestParticipantsList(from);
    if (!requests || requests.length === 0) {
      return sock.sendMessage(from, { text: '✅ *No pending join requests.*' });
    }

    const num = parseInt(args[0]);
    if (!num || isNaN(num)) {
      // Show list
      const lines = requests.map((r, i) => `${i + 1}. +${r.jid.split('@')[0]}`).join('\n');
      return sock.sendMessage(from, {
        text: `📋 *Pending Join Requests (${requests.length}):*\n\n${lines}\n\n📌 Use *approve [number]* to approve one.`,
      });
    }

    const target = requests[num - 1];
    if (!target) {
      return sock.sendMessage(from, {
        text: `❌ Request #${num} does not exist. There are only ${requests.length} pending request(s).`,
      });
    }
    await sock.groupRequestParticipantsUpdate(from, [target.jid], 'approve');
    return sock.sendMessage(from, {
      text: `✅ *Approved!*\n\n+${target.jid.split('@')[0]} has been approved to join the group.`,
    });
  } catch (e) {
    console.error('[Approve]', e.message);
    return sock.sendMessage(from, {
      text: '❌ Failed to get/approve join requests. Make sure the bot is a group admin and join approval is enabled.',
    });
  }
}

module.exports = { handle };
