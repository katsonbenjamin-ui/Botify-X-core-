'use strict';

/**
 * routes/thinClient.js — BOTIFY X Thin Client API
 *
 * POST /runtime/thin-client/validate       — validate BOTIFY-X=xxx token
 * GET  /runtime/thin-client/plugins        — serve live command/util bundle
 * POST /runtime/thin-client/:id/heartbeat  — keepalive / kill-switch
 * GET  /runtime/thin-client/:id/auth-bundle — export Baileys credentials
 */

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { Pool } = require('pg');

const registry            = require('../utils/sessionRegistry');
const { hasAuthState }    = require('../utils/pgAuthState');

const router = express.Router();

// ── Plugin bundle builder ─────────────────────────────────────────────────────
const COMMANDS_DIR = path.join(__dirname, '../commands');
const UTILS_DIR    = path.join(__dirname, '../utils');
const EVENTS_DIR   = path.join(__dirname, '../events');

const UTILS_TO_BUNDLE = [
  'messageContext.js', 'dataManager.js', 'access.js',
  'botState.js', 'msgBuffer.js', 'users.js',
];

function buildPluginBundle() {
  const files = {};
  let commandCount = 0;

  for (const f of fs.readdirSync(COMMANDS_DIR)) {
    if (!f.endsWith('.js')) continue;
    files[`commands/${f}`] = fs.readFileSync(path.join(COMMANDS_DIR, f), 'utf8');
    commandCount++;
  }

  for (const f of ['messages.js', 'groupParticipants.js', 'connection.js']) {
    const fp = path.join(EVENTS_DIR, f);
    if (fs.existsSync(fp)) files[`events/${f}`] = fs.readFileSync(fp, 'utf8');
  }

  for (const f of UTILS_TO_BUNDLE) {
    const fp = path.join(UTILS_DIR, f);
    if (fs.existsSync(fp)) files[`utils/${f}`] = fs.readFileSync(fp, 'utf8');
  }

  return {
    version:      require('../package.json').version || '1.0.0',
    generatedAt:  Date.now(),
    commandCount,
    totalFiles:   Object.keys(files).length,
    files,
  };
}

let _bundleCache = null, _bundleCacheAt = 0;
const BUNDLE_TTL = 60_000;

function getCachedBundle() {
  if (_bundleCache && Date.now() - _bundleCacheAt < BUNDLE_TTL) return _bundleCache;
  _bundleCache   = buildPluginBundle();
  _bundleCacheAt = Date.now();
  return _bundleCache;
}

// ── POST /validate ────────────────────────────────────────────────────────────
router.post('/validate', async (req, res) => {
  const { sessionToken } = req.body || {};
  if (!sessionToken) return res.status(400).json({ valid: false, reason: 'missing_token' });

  let sessionId = String(sessionToken).trim();
  if (sessionId.startsWith('BOTIFY-X=')) sessionId = sessionId.slice('BOTIFY-X='.length);
  if (!sessionId) return res.status(400).json({ valid: false, reason: 'empty_session_id' });

  try {
    if (await registry.isExpired(sessionId))
      return res.json({ valid: false, reason: 'expired', sessionId });

    if (!(await hasAuthState(sessionId)))
      return res.json({ valid: false, reason: 'not_paired', sessionId });

    await registry.register(sessionId).catch(() => {});
    return res.json({ valid: true, sessionId });
  } catch (e) {
    console.error('[ThinClient] validate error:', e.message);
    return res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

// ── GET /plugins ──────────────────────────────────────────────────────────────
router.get('/plugins', (req, res) => {
  try {
    return res.json(getCachedBundle());
  } catch (e) {
    console.error('[ThinClient] plugin bundle error:', e.message);
    return res.status(500).json({ error: 'Failed to build plugin bundle' });
  }
});

// ── POST /:id/heartbeat ───────────────────────────────────────────────────────
router.post('/:id/heartbeat', async (req, res) => {
  const { id } = req.params;
  try {
    if (await registry.isExpired(id))
      return res.json({ authorized: false, reason: 'expired' });

    const entry = await registry.getEntry(id);
    if (!entry)
      return res.json({ authorized: false, reason: 'not_found' });

    if (!(await hasAuthState(id)))
      return res.json({ authorized: false, reason: 'revoked' });

    return res.json({ authorized: true, sessionId: id });
  } catch (e) {
    console.error('[ThinClient] heartbeat error:', e.message);
    return res.status(500).json({ authorized: false, reason: 'server_error' });
  }
});

// ── GET /:id/auth-bundle ──────────────────────────────────────────────────────
router.get('/:id/auth-bundle', async (req, res) => {
  const { id } = req.params;
  if (!process.env.DATABASE_URL)
    return res.status(503).json({ error: 'No DATABASE_URL configured on CORE' });

  try {
    if (await registry.isExpired(id))
      return res.status(403).json({ error: 'Session expired' });

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query(
      'SELECT creds, keys FROM wa_auth_state WHERE session_id = $1', [id]
    );
    await pool.end();

    if (!rows.length)
      return res.status(404).json({ error: 'No auth state found for this session' });

    return res.json({ sessionId: id, creds: rows[0].creds, keys: rows[0].keys || {} });
  } catch (e) {
    console.error('[ThinClient] auth-bundle error:', e.message);
    return res.status(500).json({ error: 'Auth export failed: ' + e.message });
  }
});

module.exports = router;
