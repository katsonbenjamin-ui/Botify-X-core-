'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info()  {}, error() {}, warn()  {}, debug() {}, trace() {},
  child() { return this; },
};

/**
 * Called when the session owner replies to someone's status from their phone.
 * Saves the status media/text to "Message Yourself" — raw content only,
 * no added captions, no "Saved!" text, no sender info.
 *
 * @param {object} sock              - Baileys socket for this session
 * @param {object} msg               - The reply message
 * @param {string} sessionOwnerPhone - Phone number of the session owner
 */
async function handle(sock, msg, sessionOwnerPhone) {
  if (!sessionOwnerPhone) return;

  const destJid = String(sessionOwnerPhone).replace(/\D/g, '') + '@s.whatsapp.net';

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return;

  const quotedMsg = ctx.quotedMessage;

  const isImg  = !!quotedMsg?.imageMessage;
  const isVid  = !!quotedMsg?.videoMessage;
  const isText = !!(quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text);

  try {
    if (isImg || isVid) {
      const fakeMsg = {
        key: {
          remoteJid:   'status@broadcast',
          id:          ctx.stanzaId || msg.key.id,
          participant: ctx.participant,
          fromMe:      false,
        },
        message: quotedMsg,
      };
      const buf = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
      // Forward ONLY the raw media — no caption, no added text
      if (isImg) await sock.sendMessage(destJid, { image: buf });
      else        await sock.sendMessage(destJid, { video: buf });
    } else if (isText) {
      // Forward ONLY the original text — nothing added
      const text = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
      if (text) await sock.sendMessage(destJid, { text });
    }
  } catch (e) {
    console.error('[StatusSaver]', e.message);
  }
}

module.exports = { handle };
