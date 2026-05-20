'use strict';

const START_TIME = Date.now();

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function handle({ sock, from }) {
  await sock.sendMessage(from, { text: '⏳ *Calculating server status...*' });

  const pingStart = Date.now();
  await new Promise(r => setTimeout(r, 300));
  const ping   = Date.now() - pingStart;
  const uptime = formatUptime(Date.now() - START_TIME);

  const text = `*🔹🔹🔹 BOT STATUS 🔹🔹🔹*

🔸 *Performance*:
▸ *Ping:* ${ping}ms
▸ *Bot Uptime:* ${uptime}

🔸 *Processor*:
▸ *Temperature:* N/A°C

🔸 *Network*:
▸ *Platform:* pairing portal
▸ *NodeJS:* ${process.version}
▸ *Bot:* BOTIFY-X: v1.1.4`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
