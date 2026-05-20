'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const REG_FILE = path.join(DATA_DIR, 'session-registry.json');

function _read() {
  try { return JSON.parse(fs.readFileSync(REG_FILE, 'utf8')); } catch { return {}; }
}
function _write(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REG_FILE, JSON.stringify(data, null, 2));
}

function register(sessionId, { expiresAt = null } = {}) {
  const reg = _read();
  reg[sessionId] = { expiresAt, registeredAt: new Date().toISOString() };
  _write(reg);
}

function unregister(sessionId) {
  const reg = _read();
  delete reg[sessionId];
  _write(reg);
}

function getEntry(sessionId) { return _read()[sessionId] || null; }

function isExpired(sessionId) {
  const entry = getEntry(sessionId);
  if (!entry || !entry.expiresAt) return false;
  return new Date(entry.expiresAt) < new Date();
}

function getAllValid() {
  return Object.entries(_read())
    .filter(([, v]) => !v.expiresAt || new Date(v.expiresAt) >= new Date())
    .map(([id]) => id);
}

module.exports = { register, unregister, getEntry, isExpired, getAllValid };
