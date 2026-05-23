'use strict';

/**
 * *ship @user1 @user2 — calculate compatibility between two people.
 *
 * Uses a deterministic hash of both JIDs so the same pair always
 * gets the same score. Works in groups and DMs.
 *
 * Usage:
 *   *ship @Alice @Bob
 *   *ship (in reply + one @mention — ships replier with mentioned)
 */

const MESSAGES = [
  ['0-20',   '💔 Total mismatch. Run.',                   '❄️ Ice cold'],
  ['21-40',  '😬 Awkward at best.',                       '🙃 Maybe friends?'],
  ['41-55',  '🤔 It could work... with effort.',          '⚖️ 50/50'],
  ['56-70',  '😊 Decent vibes! Give it a shot.',          '✨ Potential'],
  ['71-85',  '🥰 Great match! Things could heat up.',     '🔥 Hot'],
  ['86-99',  '💘 Perfect soulmates. Don\'t let go!',      '💍 Destined'],
  ['100',    '🌌 ONE IN A BILLION. Cosmic love.',         '🚀 Legendary'],
];

function compatScore(jid1, jid2) {
  const str = [jid1, jid2].sort().join('|');
  // djb2 hash
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h, 31) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h) % 101; // 0–100
}

function bar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function getMessage(pct) {
  if (pct === 100) return MESSAGES[6];
  if (pct >= 86)   return MESSAGES[5];
  if (pct >= 71)   return MESSAGES[4];
  if (pct >= 56)   return MESSAGES[3];
  if (pct >= 41)   return MESSAGES[2];
  if (pct >= 21)   return MESSAGES[1];
  return MESSAGES[0];
}

function cleanNum(jid) {
  return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

async function handle({ sock, from, msg, isGroup }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctx?.mentionedJid || [];

  let jid1, jid2;

  if (mentioned.length >= 2) {
    [jid1, jid2] = mentioned;
  } else if (mentioned.length === 1 && ctx?.participant) {
    jid1 = ctx.participant;
    jid2 = mentioned[0];
  } else if (mentioned.length === 1) {
    return sock.sendMessage(from, {
      text: '❌ Mention *two people* to ship.\n📌 Usage: *ship @person1 @person2',
    });
  } else {
    return sock.sendMessage(from, {
      text: '❌ *Usage:* *ship @person1 @person2',
    });
  }

  const pct = compatScore(jid1, jid2);
  const [msg1, msg2] = getMessage(pct);
  const n1 = cleanNum(jid1);
  const n2 = cleanNum(jid2);

  const heart =
    pct >= 86 ? '💕' :
    pct >= 56 ? '💛' :
    pct >= 30 ? '🤍' : '💔';

  const text = [
    `┏▣ ◈ SHIP ◈`,
    `┃`,
    `┃ 💑 +${n1}`,
    `┃    ${heart}`,
    `┃ 💑 +${n2}`,
    `┃`,
    `┃ 📊 ${bar(pct)} ${pct}%`,
    `┃`,
    `┃ ${msg2}`,
    `┃ _${msg1}_`,
    `┗▣`,
  ].join('\n');

  await sock.sendMessage(from, {
    text,
    mentions: [jid1, jid2].filter(Boolean),
  });
}

module.exports = { handle };
