'use strict';

const https = require('https');
const http  = require('http');
const { setConnected }        = require('../utils/botState');
const { getSessionOwnerMode } = require('../utils/dataManager');

// WhatsApp channel to follow automatically after every successful pairing
const CHANNEL_JID = '0029VbCgsEh5a23yTg0FnW2O@newsletter';

// Notify Admin Dashboard that a session's runtime status changed
function notifyAdminDashboard(sessionId, status) {
  const adminUrl = process.env.ADMIN_DASHBOARD_URL;
  const apiKey   = process.env.CORE_API_KEY || '';
  if (!adminUrl || !sessionId) return;

  const endpoint = adminUrl.replace(/\/$/, '') + '/api/users/internal/runtime-callback';
  const body     = JSON.stringify({ sessionId, status });
  let url;
  try { url = new (require('url').URL)(endpoint); } catch { return; }

  const isHttps = url.protocol === 'https:';
  const lib     = isHttps ? https : http;
  const options = {
    hostname: url.hostname,
    port:     url.port || (isHttps ? 443 : 80),
    path:     url.pathname,
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'x-api-key':      apiKey,
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: 8000,
  };

  const req = lib.request(options, (res) => {
    res.resume(); // drain response
  });
  req.on('error', (err) => console.error('[BOTIFY X] Admin notify failed:', err.message));
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

async function onOpen({ session }) {
  const { sock, id, isOwner } = session;
  setConnected(true);
  console.log('[BOTIFY X] ✅ WhatsApp connected! Session:', id);

  // Auto-follow channel silently
  try {
    if (typeof sock.newsletterFollow === 'function') {
      await sock.newsletterFollow(CHANNEL_JID);
    }
  } catch (_) {}

  // ── Owner session (original behavior) ─────────────────────────────────────
  if (isOwner) {
    const phone = session.phoneNumber
      || process.env.OWNER_NUMBER
      || process.env.ADMIN_NUMBER
      || '';

    if (!phone) return;

    const jid     = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    const mode    = getSessionOwnerMode(phone);
    const modeStr = mode === 'public' ? '🌍 Public' : '🔒 Private';

    const msg = `┏▣ ◈ BOTIFY-X ◈
┃ ✅ *Connected successfully!*
┃
┃ ᴘʀᴇғɪx   : [ * ]
┃ ᴍᴏᴅᴇ     : ${modeStr}
┃ ᴠᴇʀsɪᴏɴ  : v1.1.4
┗▣`;

    setTimeout(() => sock.sendMessage(jid, { text: msg }).catch(() => {}), 3000);
    return;
  }

  // ── Client runtime session ─────────────────────────────────────────────────
  // Notify Admin Dashboard → sets runtime_status = 'active'
  if (id) {
    notifyAdminDashboard(id, 'active');
  }

  // Send WhatsApp confirmation to the client's own number
  const phone = sock.user?.id?.split(':')[0]?.split('@')[0]?.replace(/\D/g, '') || '';
  if (!phone) return;

  const jid = phone + '@s.whatsapp.net';

  const activationMsg = [
    '┏▣ ◈ BOTIFY-X ◈',
    '┃',
    '┃ ✅ *BOTIFY X ACTIVE*',
    '┃',
    '┃ Your BOTIFY X runtime is now online.',
    '┃',
    '┃ ● Status  : *ACTIVE*',
    '┃ ● Runtime : Connected successfully.',
    '┃',
    '┗▣ _Powered by BOTIFY X_',
  ].join('\n');

  setTimeout(() => sock.sendMessage(jid, { text: activationMsg }).catch(() => {}), 3000);
}

// Called when a session closes unexpectedly — notify admin
function onClose({ id, isOwner }) {
  if (isOwner) return;
  if (id) {
    notifyAdminDashboard(id, 'offline');
  }
}

module.exports = { onOpen, onClose };
