'use strict';
async function handle({ sock, from }) {
  const start = Date.now();
  await sock.sendMessage(from, { text: '⏳ _Checking response time…_' });
  const ms = Date.now() - start;
  await sock.sendMessage(from, {
    text: `*🔹 BOTIFY-X Speed:*  ${ms}ms\n`
  });
}
module.exports = { handle };
