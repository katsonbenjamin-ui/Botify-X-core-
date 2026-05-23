'use strict';

const { getGroupMsgCounts } = require('../utils/dataManager');

/**
 * *listactive — shows the most active members in this group.
 *
 * Fixes vs old version:
 * - Forces a fresh groupMetadata fetch and retries once on failure.
 * - Handles both old-style JIDs (number@s.whatsapp.net) and
 *   multi-device JIDs (number:device@s.whatsapp.net / @lid).
 * - Shows live count clearly when real-time data is available.
 */
async function handle({ sock, from, isGroup, sessionMsgCounts }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  // Fetch LIVE member list — try twice in case of a transient failure
  let memberSet = null;
  for (let attempt = 0; attempt < 2 && memberSet === null; attempt++) {
    try {
      const meta = await sock.groupMetadata(from);
      if (meta?.participants?.length) {
        memberSet = new Set(
          meta.participants.map(p => p.id.split('@')[0].split(':')[0])
        );
      }
    } catch (err) {
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Prefer real-time in-memory counts (accurate since last start)
  const memCounts = sessionMsgCounts?.get(from);

  let entries;
  if (memCounts && memCounts.size > 0) {
    entries = Array.from(memCounts.entries());
  } else {
    const persisted = getGroupMsgCounts(from);
    entries = Object.entries(persisted);
  }

  // Filter to real current members only (when metadata was available)
  if (memberSet) {
    entries = entries.filter(([phone]) => memberSet.has(phone));
  }

  if (entries.length === 0) {
    return sock.sendMessage(from, {
      text: `┏▣ ◈ ACTIVE MEMBERS ◈\n┃\n┃ No data yet. Members need to\n┃ send messages in the group first!\n┗▣`,
    });
  }

  entries.sort((a, b) => b[1] - a[1]);
  const top    = entries.slice(0, 20);
  const topMax = top[0][1] || 1;
  const medals = ['🥇', '🥈', '🥉'];

  const lines = top.map(([phone, count], i) => {
    const rank = medals[i] || `${i + 1}.`;
    const bar  = '█'.repeat(Math.max(1, Math.round((count / topMax) * 6)));
    return `┃ ${rank} +${phone}\n┃    ${bar} ${count} msg${count === 1 ? '' : 's'}`;
  });

  const source = (memCounts && memCounts.size > 0) ? 'Since last bot start' : 'All-time data';
  const total  = memberSet ? memberSet.size : '?';

  await sock.sendMessage(from, {
    text: [
      `┏▣ ◈ ACTIVE MEMBERS ◈`,
      `┃ _${source}_ · ${total} members in group`,
      `┃`,
      lines.join('\n┃\n'),
      `┃`,
      `┃ Top ${top.length} of ${entries.length} active member(s)`,
      `┗▣`,
    ].join('\n'),
  });
}

module.exports = { handle };
