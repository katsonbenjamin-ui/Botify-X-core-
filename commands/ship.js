'use strict';

/**
 * *ship @user1 @user2 — compatibility score between two people.
 *
 * FIXES:
 *   • Uses resolveMentions() from messageContext — correct for ALL message types
 *   • normalizeJid() strips MD device suffixes before hashing
 *   • Three input patterns: 2 @mentions, 1 @mention + quoted author, 1 @mention + sender
 */

const { resolveContext, resolveMentions, normalizeJid, cleanNum } = require('../utils/messageContext');

const MESSAGES = [
  { min: 0,   max: 20,  label: 'Ice cold ❄️',      msg: '💔 Total mismatch. Maybe just be strangers.' },
  { min: 21,  max: 40,  label: 'Awkward 🙃',        msg: '😬 Uncomfortable energy. Proceed with caution.' },
  { min: 41,  max: 55,  label: 'Potential ⚖️',      msg: '🤔 It could work with real effort.' },
  { min: 56,  max: 70,  label: 'Good Vibes ✨',      msg: '😊 Decent match! Give it a shot.' },
  { min: 71,  max: 85,  label: 'Hot 🔥',             msg: '🥰 Great match — things could heat up!' },
  { min: 86,  max: 99,  label: 'Destined 💍',        msg: '💘 Perfect soulmates. Do NOT let go.' },
  { min: 100, max: 100, label: 'ONE IN A BILLION 🌌', msg: '🚀 Cosmic love. Legendary.' },
];

function compatScore(jid1, jid2) {
  const str = [jid1, jid2].sort().join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 101;
}

function bar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function getLabel(pct) {
  return MESSAGES.find(m => pct >= m.min && pct <= m.max) || MESSAGES[0];
}

async function handle({ sock, from, msg }) {
  // resolveMentions() handles ALL message types (image/video/audio/text replies in groups)
  const mentions = resolveMentions(msg);
  const ctx      = resolveContext(msg);

  let jid1, jid2;

  if (mentions.length >= 2) {
    jid1 = normalizeJid(mentions[0]);
    jid2 = normalizeJid(mentions[1]);
  } else if (mentions.length === 1 && ctx?.participant) {
    jid1 = normalizeJid(ctx.participant);
    jid2 = normalizeJid(mentions[0]);
  } else if (mentions.length === 1) {
    const senderJid = msg.key.fromMe ? null : (msg.key.participant || msg.key.remoteJid);
    if (senderJid) {
      jid1 = normalizeJid(senderJid);
      jid2 = normalizeJid(mentions[0]);
    } else {
      return sock.sendMessage(from, {
        text: '❌ Mention *two people* to ship.\n📌 Usage: *ship @person1 @person2',
      });
    }
  } else {
    return sock.sendMessage(from, {
      text: '❌ *Usage:* *ship @person1 @person2',
    });
  }

  if (!jid1 || !jid2) {
    return sock.sendMessage(from, { text: '❌ Could not resolve both users.' });
  }

  const pct    = compatScore(jid1, jid2);
  const result = getLabel(pct);
  const n1     = cleanNum(jid1);
  const n2     = cleanNum(jid2);
  const heart  = pct >= 86 ? '💕' : pct >= 56 ? '💛' : pct >= 30 ? '🤍' : '💔';

  await sock.sendMessage(from, {
    text: [
      '┏▣ ◈ SHIP ◈',
      '┃',
      `┃ 💑 +${n1}`,
      `┃    ${heart}`,
      `┃ 💑 +${n2}`,
      '┃',
      `┃ 📊 ${bar(pct)} ${pct}%`,
      '┃',
      `┃ ${result.label}`,
      `┃ _${result.msg}_`,
      '┗▣',
    ].join('\n'),
    mentions: [jid1, jid2].filter(Boolean),
  });
}

module.exports = { handle };
