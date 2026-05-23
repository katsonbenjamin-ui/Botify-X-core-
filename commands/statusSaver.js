'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info()  {}, error() {}, warn()  {}, debug() {}, trace() {},
  child() { return this; },
};

/**
 * Called when the session owner replies to someone's status from their phone.
 * Saves the status media/text to "Message Yourself" — raw content only.
 *
 * Fixes vs old version:
 * - Extracts contextInfo from all message types that can carry it
 *   (text, image, video, audio, document replies to statuses).
 * - Handles status@broadcast stanza participant correctly.
 * - stanzaId fallback chain for reliable media download.
 *
 * @param {object} sock              - Baileys socket
 * @param {object} msg               - The fromMe reply message
 * @param {string} sessionOwnerPhone - Owner's phone number
 */
async function handle(sock, msg, sessionOwnerPhone) {
  if (!sessionOwnerPhone) return;

  const destJid = String(sessionOwnerPhone).replace(/\D/g, '') + '@s.whatsapp.net';

  const allMsg = msg.message || {};

  // Pull contextInfo from whichever message type the owner used to reply
  const ctx =
    allMsg.extendedTextMessage?.contextInfo ||
    allMsg.imageMessage?.contextInfo        ||
    allMsg.videoMessage?.contextInfo        ||
    allMsg.audioMessage?.contextInfo        ||
    allMsg.documentMessage?.contextInfo     ||
    null;

  if (!ctx?.quotedMessage) return;

  const quotedMsg   = ctx.quotedMessage;
  const stanzaOwner = ctx.participant || ctx.remoteJid || 'status@broadcast';

  const isImg  = !!quotedMsg?.imageMessage;
  const isVid  = !!quotedMsg?.videoMessage;
  const isAud  = !!quotedMsg?.audioMessage;
  const isText = !!(quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text);

  try {
    if (isImg || isVid || isAud) {
      const fakeMsg = {
        key: {
          remoteJid:   'status@broadcast',
          id:          ctx.stanzaId || msg.key.id,
          participant: stanzaOwner,
          fromMe:      false,
        },
        message: quotedMsg,
      };

      let buf;
      try {
        buf = await downloadMediaMessage(
          fakeMsg, 'buffer', {},
          { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
        );
      } catch (_) {
        buf = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
      }

      if (!buf || buf.length === 0) return;

      if (isImg) await sock.sendMessage(destJid, { image: buf });
      else if (isVid) await sock.sendMessage(destJid, { video: buf });
      else if (isAud) await sock.sendMessage(destJid, { audio: buf, mimetype: 'audio/mp4' });

    } else if (isText) {
      const text = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
      if (text) await sock.sendMessage(destJid, { text });
    }
  } catch (e) {
    console.error('[StatusSaver]', e.message);
  }
}

module.exports = { handle };
