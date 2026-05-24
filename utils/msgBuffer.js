'use strict';

/**
 * msgBuffer.js — in-memory rolling buffer of recent group text messages.
 *
 * Shared between events/messages.js (writer) and commands/summary.js (reader).
 * Lives in utils/ to avoid circular imports.
 *
 * Max MAX_MSGS entries per group; oldest are dropped when full.
 */

const MAX_MSGS = 100;

const _buf = new Map(); // groupJid → Array<{ sender: string, body: string, ts: number }>

function add(groupJid, sender, body) {
  if (!body || !groupJid) return;
  if (!_buf.has(groupJid)) _buf.set(groupJid, []);
  const arr = _buf.get(groupJid);
  arr.push({ sender, body, ts: Date.now() });
  if (arr.length > MAX_MSGS) arr.shift();
}

function get(groupJid) {
  return _buf.get(groupJid) || [];
}

function clear(groupJid) {
  _buf.delete(groupJid);
}

module.exports = { add, get, clear };
