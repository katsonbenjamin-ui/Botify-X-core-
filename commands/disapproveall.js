'use strict';

async function handle({ sock, from, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  try {
    const requests = await sock.groupRequestParticipantsList(from);
    if (!requests || requests.length === 0) {
      return sock.sendMessage(from, { text: '✅ *No pending join requests to reject.*' });
    }
    const jids = requests.map(r => r.jid);
    await sock.groupRequestParticipantsUpdate(from, jids, 'reject');
    return sock.sendMessage(from, {
      text: `🚫 *All Rejected!*\n\n${jids.length} join request(s) have been disapproved.`,
    });
  } catch (e) {
    console.error('[DisapproveAll]', e.message);
    return sock.sendMessage(from, {
      text: '❌ Failed to reject join requests. Make sure the bot is a group admin and join approval is enabled.',
    });
  }
}

module.exports = { handle };
