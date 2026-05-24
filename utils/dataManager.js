'use strict';

/**
 * dataManager.js — persistent storage for settings, warnings, session state.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Primary : local JSON files (fast, sync, low overhead)      │
 * │  Backup  : Postgres via pgStore (survives Railway restarts)  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * On startup, call hydrateFromPg() ONCE so that local JSON files are
 * restored from Postgres before sessions are created.  After that,
 * every write hits both the local file AND Postgres (async/best-effort).
 */

const fs   = require('fs');
const path = require('path');

const D  = path.join(__dirname, '../data');
const UF = path.join(D, 'users.json');
const SF = path.join(D, 'settings.json');
const WF = path.join(D, 'warnings.json');
const CF = path.join(D, 'msgcounts.json');

if (!fs.existsSync(D)) fs.mkdirSync(D, { recursive: true });

// ── Low-level helpers ──────────────────────────────────────────────────────────
function r(f, fb) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { return fb; }
}
function w(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Postgres write-through (lazy load — never crashes if pg unavailable) ───────
let _pgStore = null;
function pg() {
  if (!_pgStore && process.env.DATABASE_URL) {
    try { _pgStore = require('./pgStore'); } catch (_) {}
  }
  return _pgStore;
}

// Best-effort async write to Postgres. Never blocks; never throws to caller.
function pgSave(key, value) {
  const store = pg();
  if (!store) return;
  store.set(key, value).catch(() => {});
}

// ── ALL toggleable session-state keys ─────────────────────────────────────────
// Adding a new flag here automatically:
//   • includes it in loadSessionState defaults
//   • saves it via saveSessionState
//   • persists it to Postgres on every change
const SESSION_STATE_KEYS = [
  'anticall',
  'antidelete',
  'antiedit',
  'alwaysonline',
  'autoreact',
  'autotyping',
  'statusreply',
];

// ── Startup hydration from Postgres ───────────────────────────────────────────
/**
 * Call ONCE in index.js before restoring sessions.
 * Reads settings, warnings, msgcounts, and all session states from Postgres
 * and writes them to local JSON so loadSessionState() finds them.
 */
async function hydrateFromPg() {
  const store = pg();
  if (!store) return;

  console.log('[dataManager] Hydrating from Postgres...');

  try {
    await store.ready();

    // Core data files
    const hydrations = [
      { key: 'settings',  file: SF, fallback: { botMode: 'public', groups: {} } },
      { key: 'warnings',  file: WF, fallback: {} },
      { key: 'msgcounts', file: CF, fallback: {} },
    ];

    for (const { key, file } of hydrations) {
      try {
        const val = await store.get(key);
        if (val && typeof val === 'object') {
          w(file, val);
          console.log(`[dataManager] Restored ${key} from Postgres.`);
        }
      } catch (e) {
        console.error(`[dataManager] Failed to restore ${key}:`, e.message);
      }
    }

    // Session state files: any key matching state:*
    const allKeys = await store.getAllKeys();
    let stateCount = 0;
    for (const key of allKeys) {
      if (!key.startsWith('state:')) continue;
      try {
        const phoneOrId = key.slice(6);
        const state = await store.get(key);
        if (state && typeof state === 'object') {
          w(_stateFile(phoneOrId), state);
          stateCount++;
        }
      } catch (_) {}
    }
    if (stateCount) console.log(`[dataManager] Restored ${stateCount} session state(s) from Postgres.`);

  } catch (e) {
    console.error('[dataManager] Hydration failed (non-fatal):', e.message);
  }
}

// ── Users ──────────────────────────────────────────────────────────────────────
function getUsers()    { return r(UF, []); }

function addUser(phone, days = 30) {
  const users  = getUsers();
  const expiry = Date.now() + days * 86_400_000;
  const i      = users.findIndex(u => u.phone === phone);
  if (i !== -1) {
    users[i].expiry = expiry;
    users[i].active = true;
    w(UF, users);
    return users[i];
  }
  const user = { phone, expiry, active: true, addedAt: Date.now(), mode: 'public' };
  users.push(user);
  w(UF, users);
  return user;
}

function removeUser(phone) { w(UF, getUsers().filter(u => u.phone !== phone)); }

function updateUser(phone, patch) {
  const users = getUsers();
  const i     = users.findIndex(u => u.phone === phone);
  if (i === -1) return false;
  users[i] = { ...users[i], ...patch };
  w(UF, users);
  return true;
}

function isUserAllowed(phone) {
  const user = getUsers().find(u => u.phone === phone);
  if (!user)                    return { allowed: false, reason: 'not_found' };
  if (!user.active)             return { allowed: false, reason: 'inactive' };
  if (Date.now() > user.expiry) return { allowed: false, reason: 'expired' };
  return { allowed: true };
}

// ── Per-session-owner mode ────────────────────────────────────────────────────
function getSessionOwnerMode(phone) {
  if (!phone) return getSettings().botMode || 'public';
  const user = getUsers().find(u => u.phone === phone);
  if (user)   return user.mode || 'public';
  return getSettings().botMode || 'public';
}

function setSessionOwnerMode(phone, mode) {
  if (mode !== 'public' && mode !== 'private') return;
  const updated = updateUser(phone, { mode });
  if (!updated) { const s = getSettings(); s.botMode = mode; saveSettings(s); }
}

// ── Global settings ───────────────────────────────────────────────────────────
function getSettings()   { return r(SF, { botMode: 'public', groups: {} }); }

function saveSettings(s) {
  w(SF, s);
  pgSave('settings', s);              // async write-through to Postgres
}

function getBotMode()     { return getSettings().botMode || 'public'; }
function setBotMode(mode) { const s = getSettings(); s.botMode = mode; saveSettings(s); }

function getGroupSettings(gid) {
  const s = getSettings();
  if (!s.groups)      s.groups = {};
  if (!s.groups[gid]) s.groups[gid] = {
    antilink: false, welcome: false, goodbye: false, antigroupmention: false,
  };
  return s.groups[gid];
}

function updateGroupSettings(gid, patch) {
  const s = getSettings();
  if (!s.groups) s.groups = {};
  s.groups[gid] = { ...(s.groups[gid] || {}), ...patch };
  saveSettings(s);                    // persists group anti-features to Postgres
}

// ── Warnings ──────────────────────────────────────────────────────────────────
function getWarnings() { return r(WF, {}); }

function _saveWarnings(ww) {
  w(WF, ww);
  pgSave('warnings', ww);
}

function addWarning(gid, phone) {
  const ww = getWarnings(); const k = `${gid}:${phone}`;
  ww[k] = (ww[k] || 0) + 1; _saveWarnings(ww); return ww[k];
}
function resetWarnings(gid, phone) {
  const ww = getWarnings(); delete ww[`${gid}:${phone}`]; _saveWarnings(ww);
}
function getWarningCount(gid, phone) { return getWarnings()[`${gid}:${phone}`] || 0; }

// ── Per-session state ─────────────────────────────────────────────────────────
function _stateFile(phoneOrId) {
  const key = String(phoneOrId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(D, `state-${key}.json`);
}

function loadSessionState(phoneOrId) {
  const defaults = Object.fromEntries(SESSION_STATE_KEYS.map(k => [k, false]));
  return { ...defaults, ...r(_stateFile(phoneOrId), {}) };
}

function saveSessionState(phoneOrId, state) {
  try {
    if (!fs.existsSync(D)) fs.mkdirSync(D, { recursive: true });
    // Save all SESSION_STATE_KEYS (not a hardcoded subset)
    const slim = Object.fromEntries(SESSION_STATE_KEYS.map(k => [k, !!state[k]]));
    w(_stateFile(phoneOrId), slim);
    // Async write-through to Postgres so state survives restarts
    pgSave(`state:${String(phoneOrId).replace(/[^a-zA-Z0-9_-]/g, '_')}`, slim);
  } catch (e) {
    console.error('[saveSessionState] Failed for', phoneOrId, '—', e.message);
  }
}

// ── Message count tracking ────────────────────────────────────────────────────
function getMsgCounts() { return r(CF, {}); }

function addMsgCount(groupJid, phone) {
  try {
    const c = getMsgCounts();
    const k = `${groupJid}|||${phone}`;
    c[k] = (c[k] || 0) + 1;
    w(CF, c);
    // Throttle Postgres sync to every 50 messages per member to reduce I/O
    if (c[k] % 50 === 0) pgSave('msgcounts', c);
  } catch (_) {}
}

function getGroupMsgCounts(groupJid) {
  const c   = getMsgCounts();
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    if (k.startsWith(`${groupJid}|||`)) {
      out[k.slice(groupJid.length + 3)] = v;
    }
  }
  return out;
}

function resetGroupMsgCounts(groupJid) {
  try {
    const c      = getMsgCounts();
    const prefix = `${groupJid}|||`;
    for (const k of Object.keys(c)) {
      if (k.startsWith(prefix)) delete c[k];
    }
    w(CF, c);
    pgSave('msgcounts', c);
  } catch (_) {}
}

module.exports = {
  hydrateFromPg,
  SESSION_STATE_KEYS,
  getUsers, addUser, removeUser, updateUser, isUserAllowed,
  getSessionOwnerMode, setSessionOwnerMode,
  getSettings, saveSettings, getBotMode, setBotMode,
  getGroupSettings, updateGroupSettings,
  addWarning, resetWarnings, getWarningCount,
  loadSessionState, saveSessionState,
  addMsgCount, getGroupMsgCounts, resetGroupMsgCounts,
};
