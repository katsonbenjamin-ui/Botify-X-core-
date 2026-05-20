'use strict';

const fs   = require('fs');
const path = require('path');

const AUTH_DIR   = process.env.AUTH_DIR || path.join(__dirname, '../auth');
const DATA_DIR   = path.join(__dirname, '../data');
const OWNER_FILE = path.join(DATA_DIR, 'owner.json');

function _loadPersistedOwner() {
  try {
    const d = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
    return String(d.phone || '').replace(/\D/g, '');
  } catch {
    return '';
  }
}

let _ownerNumber = process.env.OWNER_NUMBER || _loadPersistedOwner();

module.exports = {
  paths: {
    auth: AUTH_DIR,
  },
  owner: {
    get number() {
      return _ownerNumber || process.env.OWNER_NUMBER || '';
    },
    set(num) {
      _ownerNumber = String(num).replace(/\D/g, '');
      process.env.OWNER_NUMBER = _ownerNumber;
      process.env.ADMIN_NUMBER = _ownerNumber;
      try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(OWNER_FILE, JSON.stringify({ phone: _ownerNumber }));
      } catch (e) {
        console.error('[Config] Failed to persist owner number:', e.message);
      }
    },
  },
};
