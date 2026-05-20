'use strict';
const express        = require('express');
const sessionManager = require('../utils/sessionManager');
const registry       = require('../utils/sessionRegistry');

const router = express.Router();
const startLocks = new Map(); // prevent duplicate socket creation per session

async function withLock(id, fn) {
  if (startLocks.get(id)) return { locked: true };
  startLocks.set(id, true);
  try { return await fn(); } finally { startLocks.delete(id); }
}

// POST /runtime/:id/register — called by panel to store expiry
router.post('/:id/register', (req, res) => {
  const { expiresAt } = req.body || {};
  registry.register(req.params.id, { expiresAt: expiresAt || null });
  return res.json({ ok: true });
});

// POST /runtime/:id/start
router.post('/:id/start', async (req, res) => {
  const { id } = req.params;
  const { expiresAt } = req.body || {};

  if (expiresAt && new Date(expiresAt) < new Date())
    return res.status(403).json({ ok: false, error: 'Account expired. Contact your admin to renew.' });

  registry.register(id, { expiresAt: expiresAt || null });

  const existing = sessionManager.getSession(id);
  if (existing && existing.sock?.user)
    return res.json({ ok: true, status: 'running', message: 'Bot already running.' });

  const result = await withLock(id, async () => {
    const s = sessionManager.getSession(id);
    if (s && s.sock?.user) return { ok: true, status: 'running', message: 'Bot already running.' };
    await sessionManager.startSession({ id, isOwner: false });
    return { ok: true, status: 'starting', message: 'Bot starting...' };
  });

  if (result.locked) return res.json({ ok: true, status: 'starting', message: 'Start already in progress...' });
  return res.json(result);
});

// POST /runtime/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    await sessionManager.stopSession(req.params.id);
    return res.json({ ok: true, status: 'stopped', message: 'Bot stopped.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /runtime/:id/restart
router.post('/:id/restart', async (req, res) => {
  const { id } = req.params;
  const { expiresAt } = req.body || {};

  if (expiresAt && new Date(expiresAt) < new Date())
    return res.status(403).json({ ok: false, error: 'Account expired. Renew to restart.' });

  try {
    await sessionManager.stopSession(id);
    await new Promise(r => setTimeout(r, 1500));
    const result = await withLock(id, async () => {
      await sessionManager.startSession({ id, isOwner: false });
      return { ok: true, status: 'restarting', message: 'Bot restarting...' };
    });
    if (result.locked) return res.json({ ok: true, status: 'restarting', message: 'Restart in progress...' });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /runtime/:id/status
router.get('/:id/status', (req, res) => {
  const { id } = req.params;

  if (registry.isExpired(id)) {
    sessionManager.stopSession(id).catch(() => {});
    return res.json({ ok: true, status: 'expired', connected: false });
  }

  const starting = startLocks.get(id);
  const session  = sessionManager.getSession(id);

  if (!session) return res.json({ ok: true, status: starting ? 'starting' : 'stopped', connected: false });

  const connected = !!session.sock?.user;
  const status = connected ? 'running' : starting ? 'starting' : session.shuttingDown ? 'stopped' : 'connecting';
  return res.json({ ok: true, status, connected, phone: session.sock?.user?.id?.split(':')[0] || null });
});

// GET /runtime/:id/validate
router.get('/:id/validate', (req, res) => {
  const { id } = req.params;
  const fs     = require('fs');
  const path   = require('path');
  const config = require('../utils/config');

  if (registry.isExpired(id)) return res.json({ ok: true, valid: false, reason: 'expired' });

  const authDir = path.join(config.paths.auth, id);
  const valid   = fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0;
  return res.json({ ok: true, valid });
});

// GET /runtime/:id/logs
router.get('/:id/logs', (req, res) => {
  return res.json({ ok: true, logs: sessionManager.getSessionLogs(req.params.id) });
});

// POST /runtime/:id/notify — WhatsApp notification (called by admin dashboard on renew)
router.post('/:id/notify', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  const session = sessionManager.getSession(id);
  if (!session || !session.sock?.user) {
    return res.status(202).json({
      ok: false, queued: true,
      message: 'Bot not currently connected — notification not sent. Client will see renewal on next login.'
    });
  }

  try {
    await session.sock.sendMessage(session.sock.user.id, { text: message });
    return res.json({ ok: true, message: 'WhatsApp notification sent.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to send: ' + err.message });
  }
});

module.exports = router;
