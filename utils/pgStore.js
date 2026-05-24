'use strict';

/**
 * pgStore.js — lightweight Postgres key-value store for settings/state
 * that must survive Railway / Oracle restarts (ephemeral filesystem).
 *
 * Table: botify_kv
 *   key        TEXT PRIMARY KEY
 *   value      JSONB
 *   updated_at TIMESTAMPTZ
 *
 * Never throws to callers — all errors are caught and logged.
 */

const { Pool } = require('pg');

let _pool  = null;
let _ready = false;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
    _pool.on('error', (err) => console.error('[pgStore] Pool error:', err.message));
  }
  return _pool;
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS botify_kv (
      key        TEXT PRIMARY KEY,
      value      JSONB         NOT NULL,
      updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
}

/** Call once on startup — ensures the table exists. */
async function ready() {
  if (_ready) return;
  try {
    await ensureTable();
    _ready = true;
  } catch (e) {
    console.error('[pgStore] ensureTable failed:', e.message);
  }
}

/**
 * Upsert a key. value is serialised to JSONB.
 * Fire-and-forget safe — never throws.
 */
async function set(key, value) {
  if (!process.env.DATABASE_URL) return;
  try {
    await ready();
    await getPool().query(
      `INSERT INTO botify_kv (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)],
    );
  } catch (e) {
    console.error('[pgStore] set error:', key, e.message);
  }
}

/**
 * Read a key. Returns the parsed JS value, or null if missing.
 */
async function get(key) {
  if (!process.env.DATABASE_URL) return null;
  try {
    await ready();
    const { rows } = await getPool().query(
      'SELECT value FROM botify_kv WHERE key = $1',
      [key],
    );
    if (!rows.length) return null;
    const v = rows[0].value;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) {
    console.error('[pgStore] get error:', key, e.message);
    return null;
  }
}

/** Return all stored keys. */
async function getAllKeys() {
  if (!process.env.DATABASE_URL) return [];
  try {
    await ready();
    const { rows } = await getPool().query('SELECT key FROM botify_kv');
    return rows.map(r => r.key);
  } catch (e) {
    console.error('[pgStore] getAllKeys error:', e.message);
    return [];
  }
}

/** Delete a key. */
async function del(key) {
  if (!process.env.DATABASE_URL) return;
  try {
    await getPool().query('DELETE FROM botify_kv WHERE key = $1', [key]);
  } catch (e) {
    console.error('[pgStore] del error:', key, e.message);
  }
}

module.exports = { ready, set, get, getAllKeys, del };
