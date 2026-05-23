'use strict';

/**
 * In-memory rolling message buffer — used by *summary.
 * Stores last MAX_MSGS text messages per group JID.
 * Shared between events/messages.js (writer) and commands/summary.js (reader).
 * Lives here to avoid circular imports.
 */

const MAX_MSGS = 100;

const _buf = new Map(); // groupJid → Array<{sender, body, ts}>

function add(groupJid, sender, body) {
  if (!_buf.has(groupJid)) _buf.set(groupJid, []);
  const arr = _buf.get(groupJid);
  arr.push({ sender, body, ts: Date.now() });
  if (arr.length > MAX_MSGS) arr.shift(); // keep last MAX_MSGS
}

function get(groupJid) {
  return _buf.get(groupJid) || [];
}

function clear(groupJid) {
  _buf.delete(groupJid);
}

module.exports = { add, get, clear };
