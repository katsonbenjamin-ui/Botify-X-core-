'use strict';

/**
 * events/messages.js — BOTIFY X Core Message Pipeline
 *
 * ROOT CAUSE FIX:
 *   Old file exported registerMessagePipeline(sock) — sessionManager.js imports
 *   { handleMessages, handleMessageDelete, handleMessageEdit, handleCall }.
 *   All 4 were undefined → 100% of commands silently broken.
 *
 *   Also fixed: dispatcher called .execute() but every command exports .handle().
 */

const NodeCache = require('node-cache');
const {
  extractText, resolveContext, isViewOnce,
  unwrapViewOnce, normalizeJid, selfJid,
} = require('../utils/messageContext');
const { checkAccess, denyMsg }            = require('../utils/access');
const { getGroupSettings, addWarning, addMsgCount } = require('../utils/dataManager');
const msgBuffer = require('../utils/msgBuffer');

const commands = {
  ai:               require('../commands/ai'),
  alwaysonline:     require('../commands/alwaysonline'),
  anticall:         require('../commands/anticall'),
  antidelete:       require('../commands/antidelete'),
  antiedit:         require('../commands/antiedit'),
  antigroupmention: require('../commands/antigroupmention'),
  antilink:         require('../commands/antilink'),
  approve:          require('../commands/approve'),
  approveall:       require('../commands/approveall'),
  autoreact:        require('../commands/autoreact'),
  autotyping:       require('../commands/autotyping'),
  backup:           require('../commands/backup'),
  block:            require('../commands/block'),
  botstatus:        require('../commands/botstatus'),
  close:            require('../commands/close'),
  closetime:        require('../commands/closetime'),
  delete:           require('../commands/delete'),
  demote:           require('../commands/demote'),
  disapproveall:    require('../commands/disapproveall'),
  getpp:            require('../commands/getpp'),
  goodbye:          require('../commands/goodbye'),
  helpers:          require('../commands/helpers'),
  hidetag:          require('../commands/hidetag'),
  kick:             require('../commands/kick'),
  listactive:       require('../commands/listactive'),
  listblocked:      require('../commands/listblocked'),
  menu:             require('../commands/menu'),
  mode:             require('../commands/mode'),
  open:             require('../commands/open'),
  opentime:         require('../commands/opentime'),
  ping:             require('../commands/ping'),
  promote:          require('../commands/promote'),
  resetcount:       require('../commands/resetcount'),
  resetlink:        require('../commands/resetlink'),
  resetwarn:        require('../commands/resetwarn'),
  runtime:          require('../commands/runtime'),
  ship:             require('../commands/ship'),
  statusreply:      require('../commands/statusreply'),
  statusSaver:      require('../commands/statusSaver'),
  sticker:          require('../commands/sticker'),
  s:                require('../commands/sticker'),
  summary:          require('../commands/summary'),
  tagall:           require('../commands/tagall'),
  togstatus:        require('../commands/togstatus'),
  toimg:            require('../commands/toimg'),
  tomp3:            require('../commands/tomp3'),
  topchat:          require('../commands/topchat'),
  tts:              require('../commands/tts'),
  unblock:          require('../commands/unblock'),
  vv:               require('../commands/vv'),
  warn:             require('../commands/warn'),
  welcome:          require('../commands/welcome'),
};

const msgCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });
const cmdDedup = new NodeCache({ stdTTL: 15,   checkperiod: 5   });

function messageLabel(msg) {
  const body = extractText(msg);
  if (body) return body;
  const m = msg?.message || {};
  if (m.imageMessage)    return '[Image]';
  if (m.videoMessage)    return '[Video]';
  if (m.audioMessage)    return '[Audio]';
  if (m.documentMessage) return `[Document: ${m.documentMessage.fileName || 'file'}]`;
  if (m.stickerMessage)  return '[Sticker]';
  if (m.viewOnceMessage || m.viewOnceMessageV2) return '[View Once]';
  return '[Media]';
}

function isGroupMentionMsg(msg) {
  if (!msg?.message) return false;
  const ctx = resolveContext(msg);
  if (msg.message.groupMentionedMessage || ctx?.groupMentionedMessage) return true;
  if (ctx?.mentionedJid?.some?.(j => j.endsWith('@g.us'))) return true;
  return false;
}

function ownerPhone(session, sock) {
  return (
    session.phoneNumber ||
    sock?.user?.id?.split(':')[0]?.split('@')[0]?.replace(/\D/g, '') || ''
  );
}

// ── handleMessages ────────────────────────────────────────────────────────────
async function handleMessages({ session, payload }) {
  const { sock } = session;
  if (payload.type !== 'notify' || !payload.messages?.length) return;

  for (const rawMsg of payload.messages) {
    try {
      if (!rawMsg.message) continue;

      const msgId     = rawMsg.key.id;
      const from      = rawMsg.key.remoteJid;
      const isSelf    = !!rawMsg.key.fromMe;
      const isGroup   = from.endsWith('@g.us');
      const senderJid = isGroup ? (rawMsg.key.participant || from) : from;
      const senderPhone = senderJid.split('@')[0].split(':')[0];
      const text = extractText(rawMsg) || '';

      // Cache every message for antidelete / antiedit / vv secret
      msgCache.set(msgId, {
        from, body: text, label: messageLabel(rawMsg),
        timestamp: rawMsg.messageTimestamp,
        fullMsg: JSON.parse(JSON.stringify(rawMsg)),
      });

      // ── Anti-group-mention ─────────────────────────────────────────
      if (isGroup && !isSelf && isGroupMentionMsg(rawMsg)) {
        const gs = getGroupSettings(from);
        if (gs?.antigroupmention) {
          try { await sock.sendMessage(from, { delete: rawMsg.key }); } catch (_) {}
          if (addWarning(from, senderPhone) >= 5) {
            try { await sock.groupParticipantsUpdate(from, [senderJid], 'remove'); } catch (_) {}
          }
          continue;
        }
      }

      // ── Anti-link ──────────────────────────────────────────────────
      if (isGroup && !isSelf) {
        const gs = getGroupSettings(from);
        if (gs?.antilink && /(https?:\/\/\S+|chat\.whatsapp\.com\/\S+)/i.test(text)) {
          try { await sock.sendMessage(from, { delete: rawMsg.key }); } catch (_) {}
          if (addWarning(from, senderPhone) >= 5) {
            try { await sock.groupParticipantsUpdate(from, [senderJid], 'remove'); } catch (_) {}
          }
          continue;
        }
      }

      // ── Status pipeline ────────────────────────────────────────────
      if (from === 'status@broadcast') {
        try { await commands.statusreply.handleAutoReply(sock, rawMsg, session.state); } catch (_) {}
        if (isSelf) {
          const op = ownerPhone(session, sock);
          try { await commands.statusSaver.handle(sock, rawMsg, op); } catch (_) {}
        }
        continue;
      }

      // ── Message count (topchat / summary) ─────────────────────────
      if (isGroup && !isSelf) {
        addMsgCount(from, senderPhone);
        if (text) msgBuffer.add(from, senderPhone, text);
      }

      // ── Auto-react ─────────────────────────────────────────────────
      if (session.state?.autoreact && !isSelf) {
        if (commands.autoreact.shouldReact?.(rawMsg, from)) {
          commands.autoreact.markCooldown?.(from);
          try {
            await sock.sendMessage(from, {
              react: { text: commands.autoreact.randomEmoji?.() || '👍', key: rawMsg.key },
            });
          } catch (_) {}
        }
      }

      // ── Auto-typing (fire-and-forget, DMs only) ────────────────────
      if (session.state?.autotyping && !isSelf && !isGroup) {
        commands.autotyping.simulateTyping?.(sock, from);
      }

      // ── Command dispatch ───────────────────────────────────────────
      const PREFIX = /^[!.*#/\\]/;
      if (!PREFIX.test(text)) continue;
      if (cmdDedup.has(msgId)) continue;
      cmdDedup.set(msgId, true);

      const parts   = text.trim().split(/ +/);
      const rawName = parts.shift().replace(PREFIX, '').toLowerCase();
      const args    = parts;
      const argStr  = args.join(' ');

      const cmd = commands[rawName];
      if (!cmd?.handle) continue;

      const op = ownerPhone(session, sock);
      if (!isSelf) {
        const ac = checkAccess(senderJid, op);
        if (!ac.allowed) {
          try { await sock.sendMessage(from, { text: denyMsg(ac.reason) }); } catch (_) {}
          continue;
        }
      }

      try {
        await cmd.handle({
          sock, from, msg: rawMsg, args, argStr,
          state: session.state, session,
          sessionOwnerPhone: op,
          isGroup, isSelf, senderJid,
        });
      } catch (e) {
        console.error(`[BOTIFY X] Command [${rawName}] error:`, e.message);
      }

    } catch (e) {
      console.error('[BOTIFY X] Pipeline error [upsert]:', e.message);
    }
  }
}

// ── handleMessageDelete ───────────────────────────────────────────────────────
function handleMessageDelete(sock, item, sessionState, session) {
  if (!sessionState?.antidelete) return;
  const keys = item?.keys || (item?.key ? [item.key] : []);
  for (const key of keys) {
    if (key.fromMe) continue;
    const c = msgCache.get(key.id);
    if (!c) continue;
    const from  = c.from || key.remoteJid;
    const label = c.label || c.body || '[Media]';
    const senderNum = (key.participant || from).split('@')[0].split(':')[0];
    const op = session?.phoneNumber || '';
    const dest = op ? op.replace(/\D/g, '') + '@s.whatsapp.net' : from;
    sock.sendMessage(dest, {
      text: `🗑️ *ANTIDELETE — Message Recovered*\n\n*From:* +${senderNum}\n*Chat:* ${from.endsWith('@g.us') ? 'Group' : 'Private'}\n\n*Content:* ${label}`,
    }).catch(() => {});
  }
}

// ── handleMessageEdit ─────────────────────────────────────────────────────────
async function handleMessageEdit(sock, updates, sessionState, session) {
  for (const update of updates) {
    try {
      const msgId = update.key?.id;
      const tgt   = update.key?.remoteJid;
      const c     = msgId ? msgCache.get(msgId) : null;

      if (sessionState?.antiedit &&
          (update.update?.editedMessage || update.update?.protocolMessage?.type === 14)) {
        if (c) {
          const op = session?.phoneNumber || '';
          const dest = op ? op.replace(/\D/g, '') + '@s.whatsapp.net' : (c.from || tgt);
          const editedText =
            update.update?.editedMessage?.message?.extendedTextMessage?.text ||
            update.update?.editedMessage?.message?.conversation || '[edited]';
          await sock.sendMessage(dest, {
            text: `✏️ *ANTIEDIT — Message Edited*\n\n*Original:* ${c.label || c.body || '[unknown]'}\n*Edited to:* ${editedText}`,
          });
        }
        continue;
      }

      if (update.update?.reactionMessage) {
        const emoji = update.update.reactionMessage.text;
        if (!emoji || !c) continue;

        const op = session?.phoneNumber ||
          sock?.user?.id?.split(':')[0]?.split('@')[0]?.replace(/\D/g, '') || '';

        if (isViewOnce?.(c.fullMsg) && op) {
          const inner = unwrapViewOnce?.(c.fullMsg.message);
          if (inner) {
            commands.vv?.handleSecret?.(sock, {
              key: { remoteJid: c.from || tgt, id: msgId,
                participant: update.key?.participant || null, fromMe: false },
              message: inner,
            }, selfJid?.(op)).catch(() => {});
          }
        }

        if (tgt === 'status@broadcast' && op && c.fullMsg) {
          commands.statusSaver?.handle?.(sock, c.fullMsg, op).catch(() => {});
        }
      }

    } catch (e) {
      console.error('[BOTIFY X] Pipeline error [update]:', e.message);
    }
  }
}

// ── handleCall ────────────────────────────────────────────────────────────────
async function handleCall(sock, calls, sessionState) {
  if (!sessionState?.anticall) return;
  for (const call of calls) {
    if (call.status !== 'offer') continue;
    try {
      await sock.rejectCall(call.id, call.from);
      await sock.sendMessage(call.from, {
        text: '📵 *Calls are disabled.*\nThis number has *Anticall* enabled. Please send a message instead.',
      });
    } catch (e) { console.error('[AntiCall]', e.message); }
  }
}

module.exports = { handleMessages, handleMessageDelete, handleMessageEdit, handleCall };
