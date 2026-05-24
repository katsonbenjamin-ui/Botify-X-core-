'use strict';

/**
 * *topchat — all-time top chatters in this group.
 *
 * FIX: Added 3-second timeout guard on groupMetadata() fetch.
 *      Always replies — even when counts are empty.
 *      Full try/catch with console.error so silent failures are visible in logs.
 */

const { getGroupMsgCounts } = require('../utils/dataManager');

const META_TIMEOUT_MS = 3_000;

async function fetchMetaSafe(sock, from) {
  try {
    return await Promise.race([
      sock.groupMetadata(from),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('groupMetadata timeout')), META_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    console.warn('[TopChat] groupMetadata failed:', e.message);
    return null;
  }
}

async function handle({ sock, from, isGroup, sessionMsgCounts }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  try {
    // Fetch live member list for filtering stale entries (non-blocking timeout)
    const meta = await fetchMetaSafe(sock, from);
    const memberSet = meta?.participants?.length
      ? new Set(meta.participants.map(p => p.id.split('@')[0].split(':')[0]))
      : null;

    // Combine persisted counts with current in-memory counts
    const persisted = getGroupMsgCounts(from);
    const memCounts = sessionMsgCounts?.get(from);

    const combined = { ...persisted };
    if (memCounts) {
      for (const [phone, cnt] of memCounts.entries()) {
        combined[phone] = (combined[phone] || 0) + cnt;
      }
    }

    let entries = Object.entries(combined);

    // Only keep current members (if metadata available)
    if (memberSet) {
      entries = entries.filter(([phone]) => memberSet.has(phone));
    }

    if (entries.length === 0) {
      return sock.sendMessage(from, {
        text: [
          '┏▣ ◈ TOP CHATTERS ◈',
          '┃',
          '┃ No chat data yet.',
          '┃ _Send some messages and try again!_',
          '┗▣',
        ].join('\n'),
      });
    }

    entries.sort((a, b) => b[1] - a[1]);
    const top    = entries.slice(0, 15);
    const topMax = top[0][1] || 1;
    const total  = entries.reduce((s, [, c]) => s + c, 0);
    const medals = ['🥇', '🥈', '🥉'];

    const lines = top.map(([phone, count], i) => {
      const rank = medals[i] || `  ${i + 1}.`;
      const pct  = Math.round((count / total) * 100);
      const bar  = '█'.repeat(Math.max(1, Math.round((count / topMax) * 8)));
      return `┃ ${rank} +${phone}\n┃    ${bar} ${count} msg${count !== 1 ? 's' : ''} (${pct}%)`;
    });

    await sock.sendMessage(from, {
      text: [
        '┏▣ ◈ TOP CHATTERS ◈',
        `┃ 📊 All-time · ${memberSet ? memberSet.size : '?'} members`,
        '┃',
        lines.join('\n┃\n'),
        '┃',
        `┃ Total tracked: ${total.toLocaleString()} messages`,
        '┗▣',
      ].join('\n'),
    });
  } catch (e) {
    console.error('[TopChat] Error:', e.message);
    await sock.sendMessage(from, {
      text: `❌ *topchat* failed: ${e.message}`,
    });
  }
}

module.exports = { handle };
