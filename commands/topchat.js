'use strict';

/**
 * *topchat — show all-time top chatters in this group.
 *
 * Unlike *listactive (which resets per bot start), *topchat uses the
 * persisted message count data (survives restarts via Postgres).
 * Cross-references with live group metadata so stale members are filtered.
 */

const { getGroupMsgCounts } = require('../utils/dataManager');

async function handle({ sock, from, isGroup, sessionMsgCounts }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  // Fetch live group member list
  let memberSet = null;
  for (let attempt = 0; attempt < 2 && !memberSet; attempt++) {
    try {
      const meta = await sock.groupMetadata(from);
      if (meta?.participants?.length) {
        memberSet = new Set(
          meta.participants.map(p => p.id.split('@')[0].split(':')[0])
        );
      }
    } catch (_) {
      if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
    }
  }

  // Combine persisted counts with in-memory counts
  const persisted = getGroupMsgCounts(from);
  const memCounts = sessionMsgCounts?.get(from);

  const combined = { ...persisted };
  if (memCounts) {
    for (const [phone, cnt] of memCounts.entries()) {
      combined[phone] = (combined[phone] || 0) + cnt;
    }
  }

  let entries = Object.entries(combined);

  if (memberSet) {
    entries = entries.filter(([phone]) => memberSet.has(phone));
  }

  if (entries.length === 0) {
    return sock.sendMessage(from, {
      text: '┏▣ ◈ TOP CHATTERS ◈\n┃\n┃ No data yet. Keep chatting!\n┗▣',
    });
  }

  entries.sort((a, b) => b[1] - a[1]);
  const top    = entries.slice(0, 15);
  const topMax = top[0][1] || 1;
  const medals = ['🥇', '🥈', '🥉'];
  const total  = entries.reduce((s, [, c]) => s + c, 0);

  const lines = top.map(([phone, count], i) => {
    const rank    = medals[i] || `  ${i + 1}.`;
    const pct     = Math.round((count / total) * 100);
    const bar     = '█'.repeat(Math.max(1, Math.round((count / topMax) * 8)));
    return `┃ ${rank} +${phone}\n┃    ${bar} ${count} msgs (${pct}%)`;
  });

  const totalMembers = memberSet ? memberSet.size : '?';

  await sock.sendMessage(from, {
    text: [
      '┏▣ ◈ TOP CHATTERS ◈',
      `┃ 📊 All-time · ${totalMembers} members`,
      '┃',
      lines.join('\n┃\n'),
      '┃',
      `┃ Total messages tracked: ${total.toLocaleString()}`,
      '┗▣',
    ].join('\n'),
  });
}

module.exports = { handle };
