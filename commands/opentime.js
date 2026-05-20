'use strict';

function parseDuration(str) {
  if (!str) return null;
  const m = str.match(/(\d+)\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:our)?s?)/i);
  if (!m) return null;
  const n    = parseInt(m[1]);
  const unit = m[2][0].toLowerCase();
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60000;
  if (unit === 'h') return n * 3600000;
  return null;
}

function humanDuration(ms) {
  if (ms < 60000)    return `${ms / 1000} second(s)`;
  if (ms < 3600000)  return `${ms / 60000} minute(s)`;
  return `${ms / 3600000} hour(s)`;
}

async function handle({ sock, from, argStr, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  const ms = parseDuration(argStr);
  if (!ms || ms < 1000) {
    return sock.sendMessage(from, {
      text: '❌ *Please specify a valid duration.*\n\n📌 Examples:\n*opentime 30 seconds\n*opentime 5 minutes\n*opentime 1 hour',
    });
  }
  const MAX_MS = 24 * 3600000;
  const capped = Math.min(ms, MAX_MS);

  try {
    await sock.groupSettingUpdate(from, 'not_announcement');
    await sock.sendMessage(from, {
      text: `🔓 *Group Opened!* ✅\n\nAll members can send messages.\n⏱️ Will automatically close in *${humanDuration(capped)}*.`,
    });
    setTimeout(async () => {
      try {
        await sock.groupSettingUpdate(from, 'announcement');
        await sock.sendMessage(from, { text: '🔒 *Group Closed!* ✅\n\nTimer expired — only admins can send messages now.' });
      } catch (_) {}
    }, capped);
  } catch (e) {
    console.error('[OpenTime]', e.message);
    return sock.sendMessage(from, {
      text: '❌ Failed to open group. Make sure the bot is a group admin.',
    });
  }
}

module.exports = { handle };
