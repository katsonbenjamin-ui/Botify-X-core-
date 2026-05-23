'use strict';

/**
 * *backup — export this session's settings and state as JSON.
 *
 * Sends a clean JSON snapshot to the owner's chat.
 * Includes: session state flags, group settings for groups the bot is in.
 * NEVER includes auth credentials or session keys.
 */

const { getSettings } = require('../utils/dataManager');

async function handle({ sock, from, state, sessionOwnerPhone }) {
  try {
    const allSettings = getSettings();

    // Strip internal fields, keep only group settings relevant to session
    const groupSettings = allSettings.groups || {};

    const snapshot = {
      exportedAt:   new Date().toISOString(),
      session:      sessionOwnerPhone || 'unknown',
      botMode:      allSettings.botMode || 'public',
      sessionState: {
        anticall:    !!state?.anticall,
        antidelete:  !!state?.antidelete,
        antiedit:    !!state?.antiedit,
        alwaysonline:!!state?.alwaysonline,
        autoreact:   !!state?.autoreact,
        autotyping:  !!state?.autotyping,
        statusreply: !!state?.statusreply,
      },
      groupSettings,
      note: 'Restore by updating your bot state and group settings. Auth keys NOT included.',
    };

    const json = JSON.stringify(snapshot, null, 2);

    // Send as plain text if small, document if large
    if (json.length <= 3000) {
      await sock.sendMessage(from, {
        text: `📦 *BOTIFY X Backup*\n\n\`\`\`json\n${json}\n\`\`\``,
      });
    } else {
      const buf = Buffer.from(json, 'utf8');
      await sock.sendMessage(from, {
        document:  buf,
        mimetype:  'application/json',
        fileName:  `botify-x-backup-${Date.now()}.json`,
        caption:   '📦 *BOTIFY X Backup* — your settings snapshot.',
      });
    }
  } catch (e) {
    console.error('[Backup]', e.message);
    await sock.sendMessage(from, { text: `❌ Backup failed: ${e.message}` });
  }
}

module.exports = { handle };
