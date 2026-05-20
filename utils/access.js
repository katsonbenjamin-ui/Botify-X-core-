'use strict';

const { getSessionOwnerMode } = require('./dataManager');
const { getAdminNumber }      = require('./botState');

// Strip device suffix: 447911123456:0@s.whatsapp.net → 447911123456
function normalizeNum(jid) {
  return (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/**
 * Checks whether a sender is allowed to use commands in a given session.
 *
 * @param {string} senderJid       - JID of the person sending the command
 * @param {string} sessionOwnerPhone - Phone number (digits only) of the person
 *                                    who linked this WhatsApp session
 *
 * Access rules:
 *  1. The global bot admin → always allowed (isAdmin: true)
 *  2. The session owner (the person who linked this phone) → always allowed
 *  3. Everyone else → depends on the session owner's mode setting:
 *       public  → allowed (group members / DM contacts can use commands)
 *       private → denied  (only the session owner can use commands)
 */
function checkAccess(senderJid, sessionOwnerPhone) {
  const senderNum  = normalizeNum(senderJid);
  const adminNum   = normalizeNum(getAdminNumber());
  const ownerNum   = normalizeNum(sessionOwnerPhone || '');

  // 1. Global admin always has full access
  if (adminNum && senderNum === adminNum) {
    return { allowed: true, isAdmin: true };
  }

  // 2. Session owner always has access to their own bot
  if (ownerNum && senderNum === ownerNum) {
    return { allowed: true, isAdmin: false };
  }

  // 3. Third parties: check the session owner's mode
  const effectiveOwner = ownerNum || adminNum;
  const mode = getSessionOwnerMode(effectiveOwner);

  if (mode === 'private') {
    return { allowed: false, reason: 'private_mode' };
  }

  return { allowed: true, isAdmin: false };
}

function denyMsg(reason) {
  const map = {
    private_mode: '🔒 Bot is in *private mode*. Only the bot owner can use commands.',
    expired:      '❌ Your access has expired. Contact the bot owner to renew.',
    not_found:    '❌ You are not authorised. Ask the bot owner to add you.',
    inactive:     '❌ Your access is disabled. Contact the bot owner.',
  };
  return map[reason] || '❌ Access denied.';
}

module.exports = { checkAccess, denyMsg };
