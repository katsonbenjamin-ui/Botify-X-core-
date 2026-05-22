'use strict';
const express        = require('express');
const sessionManager = require('../utils/sessionManager');
const registry       = require('../utils/sessionRegistry');
const { hasAuthState } = require('../utils/pgAuthState');

const router = express.Router();
const startLocks = new Map();

async function withLock(id, fn) {
  if (startLocks.get(id)) return { locked: true };
  startLocks.set(id, true);
  try { return await fn(); } finally { startLocks.delete(id); }
}

// POST /runtime/:id/register — store expiry
router.post('/:id/register', async (req, res) => {
  const { expiresAt } = req.body || {};
  await registry.register(req.params.id, { expiresAt: expiresAt || null });
  return res.json({ ok: true });
});

// POST /runtime/:id/start — activate the bot (start responding to commands)
router.post('/:id/start', async (req, res) => {
  const { id } = req.params;
  const { expiresAt } = req.body || {};

  if (expiresAt && new Date(expiresAt) < new Date())
    return res.status(403).json({ ok: false, error: 'Account expired. Contact your admin to renew.' });

  // Guard: credentials must exist in Postgres (pairing done via Portal)
  const hasCreds = await hasAuthState(id);
  if (!hasCreds) {
    return res.status(400).json({
      ok: false,
      error: 'WhatsApp not paired. Open the Pairing Portal, link your number, then try again.',
    });
  }

  await registry.register(id, { expiresAt: expiresAt || null });

  const existing = sessionManager.getSession(id);

  // Session already in memory — just activate it
  if (existing && existing.sock?.user) {
    await sessionManager.activateSession(id);
    return res.json({ ok: true, status: 'running', message: 'Bot activated and running.' });
  }

  // Session not in memory — start it (active=true from the start)
  const result = await withLock(id, async () => {
    const s = sessionManager.getSession(id);
    if (s && s.sock?.user) {
      await sessionManager.activateSession(id);
      return { ok: true, status: 'running', message: 'Bot activated and running.' };
    }
    await sessionManager.startSession({ id, isOwner: false, active: true });
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
      await sessionManager.startSession({ id, isOwner: false, active: true });
      await sessionManager.activateSession(id);
      return { ok: true, status: 'restarting', message: 'Bot restarting...' };
    });
    if (result.locked) return res.json({ ok: true, status: 'restarting', message: 'Restart in progress...' });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /runtime/:id/status
router.get('/:id/status', async (req, res) => {
  const { id } = req.params;

  const expired = await registry.isExpired(id);
  if (expired) {
    sessionManager.stopSession(id).catch(() => {});
    return res.json({ ok: true, status: 'expired', connected: false });
  }

  const starting = startLocks.get(id);
  const session  = sessionManager.getSession(id);

  if (!session) return res.json({ ok: true, status: starting ? 'starting' : 'stopped', connected: false });

  const connected = !!session.sock?.user;
  const active    = !!session.active;
  let status;
  if (!connected) {
    status = starting ? 'starting' : session.shuttingDown ? 'stopped' : 'connecting';
  } else if (!active) {
    status = 'connecting'; // connected but waiting for Start
  } else {
    status = 'running';
  }
  return res.json({ ok: true, status, connected, active, phone: session.sock?.user?.id?.split(':')[0] || null });
});

// GET /runtime/:id/validate — check if credentials exist in DB
router.get('/:id/validate', async (req, res) => {
  const { id } = req.params;

  const expired = await registry.isExpired(id);
  if (expired) return res.json({ ok: true, valid: false, reason: 'expired' });

  const valid = await hasAuthState(id);
  return res.json({ ok: true, valid });
});

// GET /runtime/:id/logs
router.get('/:id/logs', (req, res) => {
  return res.json({ ok: true, logs: sessionManager.getSessionLogs(req.params.id) });
});

// POST /runtime/:id/notify
router.post('/:id/notify', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  const session = sessionManager.getSession(id);
  if (!session || !session.sock?.user) {
    return res.status(202).json({
      ok: false, queued: true,
      message: 'Bot not currently connected — notification not sent.',
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
