'use strict';

/**
 * *vv — reveal a view-once message by replying to it.
 *
 * FIXES:
 *   • Uses resolveContext() from messageContext — works for ALL message types
 *   • unwrapViewOnce() covers all V1/V2/V2Extension layers
 *   • handleSecret now also handles plain media (image/video/audio) not just VO
 *   • reuploadRequest fallback for expired media
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const {
  resolveContext,
  unwrapViewOnce,
} = require('../utils/messageContext');

const SLOG = {
  level: 'silent',
  info(){}, error(){}, warn(){}, debug(){}, trace(){},
  child(){ return this; },
};

function mediaType(inner) {
  if (!inner) return null;
  if (inner.imageMessage) return 'image';
  if (inner.videoMessage) return 'video';
  if (inner.audioMessage) return 'audio';
  return null;
}

async function downloadWithFallback(sock, fakeMsg) {
  try {
    return await downloadMediaMessage(
      fakeMsg, 'buffer', {},
      { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
    );
  } catch (_) {
    return downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
  }
}

/**
 * *vv — manual reveal, sends media to the current chat.
 */
async function handle({ sock, from, msg }) {
  // resolveContext() picks up contextInfo from any message type
  const ctx = resolveContext(msg);

  if (!ctx?.quotedMessage) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a view-once message to reveal it.*',
    });
  }

  const qm    = ctx.quotedMessage;
  // Try VO unwrap first; fall back to plain media
  const inner = unwrapViewOnce(qm) || (
    qm.imageMessage || qm.videoMessage || qm.audioMessage ? qm : null
  );
  const type  = mediaType(inner);

  if (!type || !inner) {
    return sock.sendMessage(from, {
      text: '❌ No view-once or media found in the quoted message.',
    });
  }

  try {
    const fakeMsg = {
      key: {
        remoteJid:   ctx.remoteJid || from,
        id:          ctx.stanzaId  || msg.key.id,
        participant: ctx.participant || null,
        fromMe:      false,
      },
      message: inner,
    };

    const buf = await downloadWithFallback(sock, fakeMsg);
    if (!buf || buf.length === 0) {
      return sock.sendMessage(from, { text: '❌ Could not retrieve media — it may have expired.' });
    }

    if (type === 'image') await sock.sendMessage(from, { image: buf });
    else if (type === 'video') await sock.sendMessage(from, { video: buf });
    else if (type === 'audio') await sock.sendMessage(from, { audio: buf, mimetype: inner.audioMessage?.mimetype || 'audio/mp4' });
  } catch (e) {
    console.error('[VV]', e.message);
    await sock.sendMessage(from, { text: '❌ Could not reveal — media may have expired.' });
  }
}

/**
 * handleSecret — auto-triggered by the message pipeline when anyone replies
 * to a view-once (or plain media) with only emojis, OR reacts to it.
 * Sends raw media ONLY to the session owner's "Message Yourself".
 *
 * @param {object} sock      - Baileys socket
 * @param {object} fakeMsg   - { key, message: inner } built by the pipeline
 * @param {string} destJid   - owner's self-JID
 */
async function handleSecret(sock, fakeMsg, destJid) {
  if (!destJid || !fakeMsg?.message) return;

  const type = mediaType(fakeMsg.message);
  if (!type) return;

  try {
    const buf = await downloadWithFallback(sock, fakeMsg);
    if (!buf || buf.length === 0) return;

    if (type === 'image') await sock.sendMessage(destJid, { image: buf });
    else if (type === 'video') await sock.sendMessage(destJid, { video: buf });
    else if (type === 'audio') await sock.sendMessage(destJid, {
      audio:    buf,
      mimetype: fakeMsg.message.audioMessage?.mimetype || 'audio/mp4',
    });
  } catch (e) {
    console.error('[VV Secret]', e.message);
  }
}

module.exports = { handle, handleSecret };
