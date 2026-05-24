'use strict';

/**
 * *togstatus — post a replied-to message as the bot owner's WhatsApp status/story.
 *
 * FIXES:
 *   • Uses resolveContext() from messageContext — works for ALL message types
 *   • Passes statusJidList so WA notifies contacts (fetched from sock, fallback [])
 *   • Supports text / image / video
 *   • Fire-and-forget download — never blocks loop
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { resolveContext }       = require('../utils/messageContext');

const SLOG = {
  level: 'silent',
  info(){}, error(){}, warn(){}, debug(){}, trace(){},
  child(){ return this; },
};

/** Attempt to build a statusJidList from available sock state. */
async function getStatusJidList(sock) {
  try {
    // Baileys exposes store.contacts if a store is configured
    const contacts = sock.store?.contacts;
    if (contacts && typeof contacts === 'object') {
      return Object.keys(contacts).filter(j => j.endsWith('@s.whatsapp.net'));
    }
  } catch (_) {}
  return [];
}

async function handle({ sock, from, msg }) {
  // resolveContext() covers extendedText / image / video / audio replies
  const ctx = resolveContext(msg);

  if (!ctx?.quotedMessage) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message to post it as your status.*\n\n📌 _Usage: reply to any text, image, or video with *togstatus_',
    });
  }

  const qm    = ctx.quotedMessage;
  const isImg = !!qm.imageMessage;
  const isVid = !!qm.videoMessage;
  const isTxt = !!(qm.conversation || qm.extendedTextMessage?.text);

  if (!isImg && !isVid && !isTxt) {
    return sock.sendMessage(from, {
      text: '❌ Only text, images, and videos can be posted as status.',
    });
  }

  await sock.sendMessage(from, { text: '⏳ _Posting to status..._' });

  // Fire-and-forget — media download is heavy
  setImmediate(async () => {
    try {
      const statusJidList = await getStatusJidList(sock);

      if (isImg || isVid) {
        const originJid = ctx.remoteJid || from;
        const fakeMsg   = {
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
          buf = await downloadMediaMessage(
            fakeMsg, 'buffer', {},
            { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
          );
        } catch (_) {
          const fallback = { ...fakeMsg, key: { ...fakeMsg.key, remoteJid: from } };
          buf = await downloadMediaMessage(fallback, 'buffer', {}, { logger: SLOG });
        }

        if (!buf || buf.length === 0) {
          return sock.sendMessage(from, { text: '❌ Could not download media. It may have expired.' });
        }

        const payload = isImg
          ? { image: buf, caption: qm.imageMessage?.caption || '' }
          : { video: buf, caption: qm.videoMessage?.caption || '' };

        await sock.sendMessage(
          'status@broadcast',
          payload,
          statusJidList.length ? { statusJidList } : undefined,
        );

      } else {
        const text = qm.conversation || qm.extendedTextMessage?.text || '';
        if (!text.trim()) {
          return sock.sendMessage(from, { text: '❌ Empty text — nothing to post.' });
        }
        await sock.sendMessage(
          'status@broadcast',
          { text },
          statusJidList.length ? { statusJidList } : undefined,
        );
      }

      await sock.sendMessage(from, {
        text: '✅ *Posted to your WhatsApp status!*\n_Contacts who have your number saved will see it._',
      });
    } catch (e) {
      console.error('[TogStatus]', e.message);
      try { await sock.sendMessage(from, { text: `❌ Failed to post status: ${e.message}` }); } catch {}
    }
  });
}

module.exports = { handle };
