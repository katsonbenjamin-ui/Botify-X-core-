'use strict';
const fs   = require('fs');
const path = require('path');

const D  = path.join(__dirname, '../data');
const UF = path.join(D, 'users.json');
const SF = path.join(D, 'settings.json');
const WF = path.join(D, 'warnings.json');
const CF = path.join(D, 'msgcounts.json');

if (!fs.existsSync(D)) fs.mkdirSync(D, { recursive: true });

function r(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function w(f, d)  { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Users ─────────────────────────────────────────────────────────────────────
function getUsers()     { return r(UF, []); }

function addUser(phone, days = 30) {
  const users  = getUsers();
  const expiry = Date.now() + days * 86400000;
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
  if (user) return user.mode || 'public';
  return getSettings().botMode || 'public';
}

function setSessionOwnerMode(phone, mode) {
  if (mode !== 'public' && mode !== 'private') return;
  const updated = updateUser(phone, { mode });
  if (!updated) {
    const s = getSettings();
    s.botMode = mode;
    saveSettings(s);
  }
}

// ── Global settings ───────────────────────────────────────────────────────────
function getSettings()    { return r(SF, { botMode: 'public', groups: {} }); }
function saveSettings(s)  { w(SF, s); }
function getBotMode()     { return getSettings().botMode || 'public'; }
function setBotMode(mode) { const s = getSettings(); s.botMode = mode; saveSettings(s); }

function getGroupSettings(gid) {
  const s = getSettings();
  if (!s.groups)       s.groups = {};
  if (!s.groups[gid])  s.groups[gid] = { antilink: false, welcome: false, goodbye: false, antigroupmention: false };
  return s.groups[gid];
}

function updateGroupSettings(gid, patch) {
  const s = getSettings();
  if (!s.groups) s.groups = {};
  s.groups[gid] = { ...(s.groups[gid] || {}), ...patch };
  saveSettings(s);
}

// ── Warnings ──────────────────────────────────────────────────────────────────
function getWarnings()             { return r(WF, {}); }
function addWarning(gid, phone)    {
  const ww = getWarnings(); const k = `${gid}:${phone}`;
  ww[k] = (ww[k] || 0) + 1; w(WF, ww); return ww[k];
}
function resetWarnings(gid, phone) { const ww = getWarnings(); delete ww[`${gid}:${phone}`]; w(WF, ww); }
function getWarningCount(gid, phone) { return getWarnings()[`${gid}:${phone}`] || 0; }

// ── Per-session state persistence ─────────────────────────────────────────────
function _stateFile(phoneOrId) {
  const key = String(phoneOrId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(D, `state-${key}.json`);
}

function loadSessionState(phoneOrId) {
  return r(_stateFile(phoneOrId), {
    anticall: false, antidelete: false, antiedit: false, alwaysonline: false,
  });
}

function saveSessionState(phoneOrId, state) {
  try {
    if (!fs.existsSync(D)) fs.mkdirSync(D, { recursive: true });
    const keys = ['anticall', 'antidelete', 'antiedit', 'alwaysonline'];
    const slim = {};
    for (const k of keys) slim[k] = !!state[k];
    w(_stateFile(phoneOrId), slim);
  } catch (e) {
    console.error('[SaveSessionState] Failed to save state for', phoneOrId, '—', e.message);
  }
}

// ── Message count tracking (for *listactive) ──────────────────────────────────
function getMsgCounts() { return r(CF, {}); }

function addMsgCount(groupJid, phone) {
  try {
    const c = getMsgCounts();
    const k = `${groupJid}|||${phone}`;
    c[k] = (c[k] || 0) + 1;
    w(CF, c);
  } catch (_) {}
}

function getGroupMsgCounts(groupJid) {
  const c   = getMsgCounts();
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    if (k.startsWith(`${groupJid}|||`)) {
      const phone = k.slice(groupJid.length + 3);
      out[phone]  = v;
    }
  }
  return out;
}

/**
 * Reset all message count data for a specific group.
 * Used by the *resetcount command.
 */
function resetGroupMsgCounts(groupJid) {
  try {
    const c      = getMsgCounts();
    const prefix = `${groupJid}|||`;
    for (const k of Object.keys(c)) {
      if (k.startsWith(prefix)) delete c[k];
    }
    w(CF, c);
  } catch (_) {}
}

module.exports = {
  getUsers, addUser, removeUser, updateUser, isUserAllowed,
  getSessionOwnerMode, setSessionOwnerMode,
  getSettings, saveSettings, getBotMode, setBotMode,
  getGroupSettings, updateGroupSettings,
  addWarning, resetWarnings, getWarningCount,
  loadSessionState, saveSessionState,
  addMsgCount, getGroupMsgCounts, resetGroupMsgCounts,
};
