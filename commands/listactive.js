'use strict';

const { getGroupMsgCounts } = require('../utils/dataManager');

/**
 * *listactive — shows the most active members in this group.
 * Uses real-time in-memory counts from the current session.
 * Cross-references with actual group members via groupMetadata so
 * only real participants appear in the list.
 */
async function handle({ sock, from, isGroup, sessionMsgCounts }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  // Fetch real member list from WhatsApp
  let memberSet = null;
  try {
    const meta = await sock.groupMetadata(from);
    memberSet  = new Set(meta.participants.map(p => p.id.split('@')[0].split(':')[0]));
  } catch (_) {
    // If metadata fetch fails, proceed without filtering
  }

  // Use in-memory per-session counts (reset on restart = accurate current data)
  const memCounts = sessionMsgCounts?.get(from);

  let entries;
  if (memCounts && memCounts.size > 0) {
    entries = Array.from(memCounts.entries());
  } else {
    const persisted = getGroupMsgCounts(from);
    entries = Object.entries(persisted);
  }

  // Filter to real current group members only
  if (memberSet) {
    entries = entries.filter(([phone]) => memberSet.has(phone));
  }

  if (entries.length === 0) {
    return sock.sendMessage(from, {
      text: `┏▣ ◈ ACTIVE MEMBERS ◈\n┃\n┃ No data yet. Members need to\n┃ send messages in the group first!\n┗▣`,
    });
  }

  // Sort descending by count
  entries.sort((a, b) => b[1] - a[1]);
  const top     = entries.slice(0, 20);
  const topMax  = top[0][1] || 1;
  const medals  = ['🥇', '🥈', '🥉'];

  const lines = top.map(([phone, count], i) => {
    const rank = medals[i] || `${i + 1}.`;
    const bar  = '█'.repeat(Math.max(1, Math.round((count / topMax) * 6)));
    return `┃ ${rank} +${phone}\n┃    ${bar} ${count} msg${count === 1 ? '' : 's'}`;
  });

  const source = (memCounts && memCounts.size > 0) ? 'Since last bot start' : 'All-time data';

  await sock.sendMessage(from, {
    text: `┏▣ ◈ ACTIVE MEMBERS ◈\n┃ _${source}_\n┃\n${lines.join('\n┃\n')}\n┃\n┃ Top ${top.length} of ${entries.length} active member(s)\n┗▣`,
  });
}

module.exports = { handle };
