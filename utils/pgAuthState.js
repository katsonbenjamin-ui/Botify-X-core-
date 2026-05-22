'use strict';

/**
 * Baileys auth state backed by Postgres.
 * Survives Railway restarts — no filesystem dependency.
 *
 * Table: wa_auth_state
 *   session_id TEXT PRIMARY KEY
 *   creds      JSONB NOT NULL
 *   keys       JSONB NOT NULL DEFAULT '{}'
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 */

const { proto } = require('@whiskeysockets/baileys');
const {
  initAuthCreds,
  BufferJSON,
} = require('@whiskeysockets/baileys');

const { Pool } = require('pg');

let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    _pool.on('error', (err) => console.error('[pgAuth] Pool error:', err.message));
  }
  return _pool;
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS wa_auth_state (
      session_id TEXT PRIMARY KEY,
      creds      JSONB NOT NULL,
      keys       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Returns a Baileys-compatible { state, saveCreds } backed by Postgres.
 * Drop-in replacement for useMultiFileAuthState().
 */
async function usePgAuthState(sessionId) {
  await ensureTable();
  const pool = getPool();

  const { rows } = await pool.query(
    'SELECT creds, keys FROM wa_auth_state WHERE session_id = $1',
    [sessionId]
  );

  let creds;
  let keysObj = {};

  if (rows.length && rows[0].creds) {
    try {
      creds   = JSON.parse(JSON.stringify(rows[0].creds), BufferJSON.reviver);
      keysObj = JSON.parse(JSON.stringify(rows[0].keys  || {}), BufferJSON.reviver);
    } catch {
      creds   = initAuthCreds();
      keysObj = {};
    }
  } else {
    creds   = initAuthCreds();
    keysObj = {};
  }

  const state = {
    creds,
    keys: {
      get(type, ids) {
        const data = {};
        for (const id of ids) {
          const val = keysObj[`${type}-${id}`];
          if (val) {
            let parsed = val;
            if (type === 'app-state-sync-key' && val) {
              try { parsed = proto.Message.AppStateSyncKeyData.fromObject(val); } catch {}
            }
            data[id] = parsed;
          }
        }
        return data;
      },
      set(data) {
        for (const category of Object.keys(data)) {
          for (const id of Object.keys(data[category])) {
            const val = data[category][id];
            if (val) {
              keysObj[`${category}-${id}`] = JSON.parse(JSON.stringify(val, BufferJSON.replacer));
            } else {
              delete keysObj[`${category}-${id}`];
            }
          }
        }
        // Persist keys asynchronously — don't block the caller
        _persistKeys(sessionId, keysObj).catch(err =>
          console.error('[pgAuth] Keys persist error:', err.message)
        );
      },
    },
  };

  async function saveCreds() {
    const credsJson = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
    const keysJson  = JSON.parse(JSON.stringify(keysObj, BufferJSON.replacer));
    await pool.query(
      `INSERT INTO wa_auth_state (session_id, creds, keys, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (session_id) DO UPDATE
         SET creds = $2, keys = $3, updated_at = NOW()`,
      [sessionId, credsJson, keysJson]
    );
  }

  return { state, saveCreds };
}

async function _persistKeys(sessionId, keysObj) {
  const keysJson = JSON.parse(JSON.stringify(keysObj, BufferJSON.replacer));
  await getPool().query(
    `UPDATE wa_auth_state SET keys = $2, updated_at = NOW() WHERE session_id = $1`,
    [sessionId, keysJson]
  );
}

/**
 * Check whether a session has credentials in Postgres.
 */
async function hasAuthState(sessionId) {
  await ensureTable();
  const { rows } = await getPool().query(
    'SELECT 1 FROM wa_auth_state WHERE session_id = $1',
    [sessionId]
  );
  return rows.length > 0;
}

/**
 * Delete credentials from Postgres (called on logout / delete session).
 */
async function deleteAuthState(sessionId) {
  await getPool().query('DELETE FROM wa_auth_state WHERE session_id = $1', [sessionId]);
}

module.exports = { usePgAuthState, hasAuthState, deleteAuthState };
