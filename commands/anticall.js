'use strict';

async function handle({ sock, from, args, state }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    state.anticall = true;
    return sock.sendMessage(from, {
      text: `📵 *Anticall Enabled!* ✅\n\nIncoming calls will be automatically *rejected* and the caller will receive a notice.`,
    });
  }
  if (sub === 'off') {
    state.anticall = false;
    return sock.sendMessage(from, {
      text: `📞 *Anticall Disabled.* ❌\n\nThe bot will now accept incoming calls normally.`,
    });
  }
  return sock.sendMessage(from, {
    text: `📵 *Anticall Status:* ${state.anticall ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*anticall on — Enable\n*anticall off — Disable`,
  });
}

module.exports = { handle };
