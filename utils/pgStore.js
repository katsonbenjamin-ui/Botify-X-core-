'use strict';

const { Pool } = require('pg');

let pool = null;
let tableReady = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    pool.on('error', (err) => console.error('[pgStore] Pool error:', err.message));
  }
  return pool;
}

async function ensureTable() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS botify_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return true;
  } catch (e) {
    console.error('[pgStore] ensureTable failed:', e.message);
    return false;
  }
}

function ready() {
  if (tableReady === null) tableReady = ensureTable();
  return tableReady;
}

async function get(key) {
  try {
    if (!await ready()) return null;
    const p = getPool();
    if (!p) return null;
    const r = await p.query('SELECT value FROM botify_settings WHERE key = $1', [key]);
    return r.rows[0]?.value ?? null;
  } catch (e) {
    console.error('[pgStore] get error:', e.message);
    return null;
  }
}

async function set(key, value) {
  try {
    if (!await ready()) return;
    const p = getPool();
    if (!p) return;
    await p.query(
      `INSERT INTO botify_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  } catch (e) {
    console.error('[pgStore] set error:', e.message);
  }
}

module.exports = { get, set, ready };
