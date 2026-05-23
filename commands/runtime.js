'use strict';

/**
 * *runtime — show live system stats for this BOTIFY X session.
 *
 * Displays: uptime, RAM, CPU load, ping, Node version, platform.
 * Lightweight — uses only Node built-ins (os, process).
 * No circular dependency: does not import sessionManager.
 */

const os = require('os');

const START_TIME = Date.now();

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m ${s % 60}s`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function handle({ sock, from, state }) {
  const pingStart = Date.now();
  // tiny async op to measure actual event loop latency
  await new Promise(r => setImmediate(r));
  const ping = Date.now() - pingStart;

  const mem    = process.memoryUsage();
  const uptime = formatUptime(Date.now() - START_TIME);
  const load   = os.loadavg();
  const cpuPct = Math.min(100, Math.round(load[0] * 100 / os.cpus().length));

  const flags = [
    state?.antidelete  ? '🗑️AD'  : null,
    state?.antiedit    ? '✏️AE'  : null,
    state?.anticall    ? '📵AC'  : null,
    state?.autoreact   ? '⚡AR'  : null,
    state?.autotyping  ? '⌨️AT'  : null,
    state?.statusreply ? '👁️SR' : null,
    state?.alwaysonline? '🟢AO'  : null,
  ].filter(Boolean);

  const text = [
    '┏▣ ◈ BOTIFY X RUNTIME ◈',
    '┃',
    `┃ ⏱️  Uptime      : ${uptime}`,
    `┃ ⚡  Ping        : ${ping}ms`,
    '┃',
    `┃ 🧠  Heap Used   : ${fmtMB(mem.heapUsed)}`,
    `┃ 💾  RSS         : ${fmtMB(mem.rss)}`,
    `┃ 🔧  Heap Total  : ${fmtMB(mem.heapTotal)}`,
    '┃',
    `┃ 🖥️  CPU Load    : ${cpuPct}% (1m avg)`,
    `┃ 🏗️  Platform    : ${os.platform()} ${os.arch()}`,
    `┃ 🟢  Node.js     : ${process.version}`,
    '┃',
    `┃ 🔩  Active Flags: ${flags.length ? flags.join(' ') : 'none'}`,
    '┃',
    '┃ _Powered by BOTIFY X_',
    '┗▣',
  ].join('\n');

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
