'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info() {}, error() {}, warn() {}, debug() {}, trace() {},
  child() { return this; },
};

/**
 * *togstatus — reply to any message (text/image/video) to post it as
 * the bot session owner's WhatsApp status (story). Group members who
 * have the bot's number saved will see it in their status tab.
 */
async function handle({ sock, from, msg }) {
  // Look for a quoted message in the reply context
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message to post it as your status.*\n\n📌 _Usage: reply to any text, image, or video with *togstatus_',
    });
  }

  const qm    = ctx.quotedMessage;
  const isImg = !!qm.imageMessage;
  const isVid = !!qm.videoMessage;
  const isText = !!(qm.conversation || qm.extendedTextMessage?.text);

  if (!isImg && !isVid && !isText) {
    return sock.sendMessage(from, {
      text: '❌ Only text, images, and videos can be posted as status.',
    });
  }

  try {
    if (isImg || isVid) {
      // Build a fake message so downloadMediaMessage can fetch the media.
      // remoteJid must be where the original message lives — use ctx.remoteJid
      // when available (status/@broadcast or group jid), else fall back to from.
      const originJid = ctx.remoteJid || from;
      const fakeMsg = {
        key: {
          remoteJid:   originJid,
          id:          ctx.stanzaId || msg.key.id,
          participant: ctx.participant || null,
          fromMe:      false,
        },
        message: qm,
      };

      let buf;
      try {
        buf = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
      } catch (dlErr) {
        // Second attempt using the current chat JID as remoteJid
        const fallback = { ...fakeMsg, key: { ...fakeMsg.key, remoteJid: from } };
        buf = await downloadMediaMessage(fallback, 'buffer', {}, { logger: SLOG });
      }

      if (!buf || buf.length === 0) {
        return sock.sendMessage(from, { text: '❌ Could not download the media. It may have expired.' });
      }

      if (isImg) {
        await sock.sendMessage('status@broadcast', { image: buf, caption: '' });
      } else {
        await sock.sendMessage('status@broadcast', { video: buf, caption: '' });
      }
    } else if (isText) {
      const text = qm.conversation || qm.extendedTextMessage?.text || '';
      if (!text) {
        return sock.sendMessage(from, { text: '❌ Could not read the text message.' });
      }
      await sock.sendMessage('status@broadcast', { text });
    }

    await sock.sendMessage(from, { text: '✅ *Posted to your WhatsApp status!*\n\n_Group members who have your number saved will see it._' });
  } catch (e) {
    console.error('[TogStatus]', e.message);
    await sock.sendMessage(from, { text: `❌ Failed to post status: ${e.message}` });
  }
}

module.exports = { handle };
