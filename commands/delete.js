'use strict';

/**
 * *delete — reply to any message to delete it.
 * In groups the bot must be admin. In DMs it can only delete its own messages.
 */
async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.stanzaId) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message to delete it.*\n\n📌 Usage: *delete',
    });
  }

  const deleteKey = {
    remoteJid:   from,
    id:          ctx.stanzaId,
    participant: ctx.participant || undefined,
    fromMe:      false,
  };

  try {
    await sock.sendMessage(from, { delete: deleteKey });
    // Also silently delete the *delete command message itself
    await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
  } catch (e) {
    console.error('[Delete]', e.message);
    await sock.sendMessage(from, {
      text: '❌ Could not delete — bot needs to be admin in groups, or can only delete its own messages in DMs.',
    });
  }
}

module.exports = { handle };
