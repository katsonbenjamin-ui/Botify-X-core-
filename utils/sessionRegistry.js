'use strict';

/**
 * Session registry — backed by Postgres so it survives Railway restarts.
 *
 * Table: session_registry
 *   session_id    TEXT PRIMARY KEY
 *   expires_at    TIMESTAMPTZ
 *   active        BOOLEAN NOT NULL DEFAULT FALSE
 *   registered_at TIMESTAMPTZ DEFAULT NOW()
 */

const { Pool } = require('pg');

let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    _pool.on('error', (err) => console.error('[sessionRegistry] Pool error:', err.message));
  }
  return _pool;
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS session_registry (
      session_id    TEXT PRIMARY KEY,
      expires_at    TIMESTAMPTZ,
      active        BOOLEAN NOT NULL DEFAULT FALSE,
      registered_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// Call once on startup
let _ready = false;
async function init() {
  if (_ready) return;
  await ensureTable();
  _ready = true;
}

async function register(sessionId, { expiresAt = null } = {}) {
  await init();
  await getPool().query(
    `INSERT INTO session_registry (session_id, expires_at, registered_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (session_id) DO UPDATE
       SET expires_at = EXCLUDED.expires_at`,
    [sessionId, expiresAt || null]
  );
}

async function unregister(sessionId) {
  await init();
  await getPool().query('DELETE FROM session_registry WHERE session_id = $1', [sessionId]);
}

async function activate(sessionId) {
  await init();
  await getPool().query(
    'UPDATE session_registry SET active = TRUE WHERE session_id = $1',
    [sessionId]
  );
}

async function deactivate(sessionId) {
  await init();
  await getPool().query(
    'UPDATE session_registry SET active = FALSE WHERE session_id = $1',
    [sessionId]
  );
}

async function isActive(sessionId) {
  await init();
  const { rows } = await getPool().query(
    'SELECT active FROM session_registry WHERE session_id = $1',
    [sessionId]
  );
  return rows.length > 0 && rows[0].active === true;
}

async function isExpired(sessionId) {
  await init();
  const { rows } = await getPool().query(
    'SELECT expires_at FROM session_registry WHERE session_id = $1',
    [sessionId]
  );
  if (!rows.length || !rows[0].expires_at) return false;
  return new Date(rows[0].expires_at) < new Date();
}

async function getEntry(sessionId) {
  await init();
  const { rows } = await getPool().query(
    'SELECT session_id, expires_at, active, registered_at FROM session_registry WHERE session_id = $1',
    [sessionId]
  );
  return rows[0] || null;
}

async function getAllValid() {
  await init();
  const { rows } = await getPool().query(
    `SELECT session_id FROM session_registry
     WHERE expires_at IS NULL OR expires_at >= NOW()`
  );
  return rows.map(r => r.session_id);
}

module.exports = { register, unregister, activate, deactivate, isActive, isExpired, getEntry, getAllValid, init };
