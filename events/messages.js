'use strict';

/**
 * events/messages.js — BOTIFY X core message pipeline.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ALL context/JID resolution now goes through messageContext.js.
 * No direct extendedTextMessage-only access anywhere in this file.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * FIXES IN THIS VERSION:
 *  1.  Centralized parsing — all resolveContext / extractText / resolveMentions
 *      calls go through utils/messageContext.js
 *  2.  reactionMessage path — emoji reactions now trigger VO reveal + status save
 *  3.  antidelete — full media restore (image/video/audio/doc/sticker) via
 *      downloadMediaMessage + reuploadRequest; text fallback always works
 *  4.  antidelete modern — REVOKE detected in both messages.update AND upsert
 *  5.  antiedit — text + caption edits via both protocolMessage.type=14 and
 *      editedMessage inline
 *  6.  antigroupmention — mentionedJid @g.us detection (modern Baileys)
 *  7.  autotyping — true fire-and-forget 600–1400ms cycle (never blocks)
 *  8.  autoreact — per-chat cooldown, ignores reactions + self messages
 *  9.  statusreply — correctly triggered on status@broadcast messages
 * 10.  viewOnce reveal — covers all VO layers via unwrapViewOnce()
 * 11.  Global safety — unhandledRejection / uncaughtException in index.js,
 *      per-command try/catch with full error logging here
 */

const NodeCache = require('node-cache');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// ── Centralized message context (replaces all direct .extendedTextMessage access) ─
const {
  extractText,
  resolveContext,
  resolveQuoted,
  resolveMentions,
  resolveMediaType,
  isStatus,
  isViewOnce,
  isReaction,
  unwrapViewOnce,
  normalizeJid,
  cleanNum,
  selfJid,
} = require('../utils/messageContext');

const { checkAccess, denyMsg }    = require('../utils/access');
const { getAdminNumber }          = require('../utils/botState');
const {
  getGroupSettings, addWarning, resetWarnings, addMsgCount,
} = require('../utils/dataManager');
const msgBuffer                   = require('../utils/msgBuffer');

// ── Command imports ────────────────────────────────────────────────────────────
const antilinkCmd         = require('../commands/antilink');
const anticallCmd         = require('../commands/anticall');
const antideleteCmd       = require('../commands/antidelete');
const antieditCmd         = require('../commands/antiedit');
const antigroupmentionCmd = require('../commands/antigroupmention');
const approveCmd          = require('../commands/approve');
const approveallCmd       = require('../commands/approveall');
const disapproveallCmd    = require('../commands/disapproveall');
const closeCmd            = require('../commands/close');
const closetimeCmd        = require('../commands/closetime');
const openCmd             = require('../commands/open');
const opentimeCmd         = require('../commands/opentime');
const listactiveCmd       = require('../commands/listactive');
const togstatusCmd        = require('../commands/togstatus');
const blockCmd            = require('../commands/block');
const unblockCmd          = require('../commands/unblock');
const listblockedCmd      = require('../commands/listblocked');
const deleteCmd           = require('../commands/delete');
const alwaysonlineCmd     = require('../commands/alwaysonline');
const helpersCmd          = require('../commands/helpers');
const promoteCmd          = require('../commands/promote');
const demoteCmd           = require('../commands/demote');
const kickCmd             = require('../commands/kick');
const resetlinkCmd        = require('../commands/resetlink');
const welcomeCmd          = require('../commands/welcome');
const goodbyeCmd          = require('../commands/goodbye');
const tagallCmd           = require('../commands/tagall');
const hidetagCmd          = require('../commands/hidetag');
const warnCmd             = require('../commands/warn');
const resetwarnCmd        = require('../commands/resetwarn');
const resetcountCmd       = require('../commands/resetcount');
const vvCmd               = require('../commands/vv');
const getppCmd            = require('../commands/getpp');
const pingCmd             = require('../commands/ping');
const modeCmd             = require('../commands/mode');
const stickerCmd          = require('../commands/sticker');
const menuCmd             = require('../commands/menu');
const botstatusCmd        = require('../commands/botstatus');
const statusSaver         = require('../commands/statusSaver');
const aiCmd               = require('../commands/ai');
const summaryCmd          = require('../commands/summary');
const autoreactCmd        = require('../commands/autoreact');
const statusreplyCmd      = require('../commands/statusreply');
const shipCmd             = require('../commands/ship');
const topchatCmd          = require('../commands/topchat');
const toimgCmd            = require('../commands/toimg');
const tomp3Cmd            = require('../commands/tomp3');
const ttsCmd              = require('../commands/tts');
const runtimeCmd          = require('../commands/runtime');
const backupCmd           = require('../commands/backup');
const autotypingCmd       = require('../commands/autotyping');

// ── Caches ─────────────────────────────────────────────────────────────────────
// msgCache stores { from, body, fullMsg } — fullMsg enables media antidelete
const msgCache  = new NodeCache({ stdTTL: 600,  checkperiod: 60  });
// editCache stores original text indexed by message ID for antiedit before/after
const editCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
// cmdDedup prevents the same command from firing twice in multi-device scenarios
const cmdDedup  = new NodeCache({ stdTTL: 30,   checkperiod: 10  });

// In-memory per-group message counts (listactive + topchat)
const sessionMsgCounts = new Map();

// ── Silent logger (for downloadMediaMessage) ───────────────────────────────────
const SLOG = {
  level: 'silent',
  info(){}, error(){}, warn(){}, debug(){}, trace(){},
  child(){ return this; },
};

// ── Constants ─────────────────────────────────────────────────────────────────
const LINK_RE  = /(https?:\/\/\S+|chat\.whatsapp\.com\/\S+)/i;
// Matches ONLY emoji characters — used for secret view-once / status-save trigger
const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u;

// ── Helpers ───────────────────────────────────────────────────────────────────
function messageLabel(msg) {
  const body = extractText(msg);
  if (body) return body;
  const m = msg.message;
  if (!m) return '';
  if (m.imageMessage)        return '[Image]';
  if (m.videoMessage)        return '[Video]';
  if (m.audioMessage)        return '[Audio]';
  if (m.documentMessage)     return `[Document: ${m.documentMessage.fileName || 'file'}]`;
  if (m.stickerMessage)      return '[Sticker]';
  if (m.contactMessage)      return '[Contact]';
  if (m.locationMessage)     return '[Location]';
  if (m.liveLocationMessage) return '[Live Location]';
  if (m.pollCreationMessage) return `[Poll: ${m.pollCreationMessage.name || ''}]`;
  if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension)
    return '[View Once]';
  return '[Media]';
}

function extractEditedText(proto) {
  const ec = proto?.editedMessage;
  if (!ec) return '';
  return (
    ec.conversation                        ||
    ec.extendedTextMessage?.text           ||
    ec.imageMessage?.caption               ||
    ec.videoMessage?.caption               ||
    ec.documentMessage?.caption            ||
    ec.message?.conversation               ||
    ec.message?.extendedTextMessage?.text  ||
    ec.message?.imageMessage?.caption      ||
    ec.message?.videoMessage?.caption      ||
    ''
  );
}

/**
 * antigroupmention check using all three Baileys formats:
 *   1. msg.message.groupMentionedMessage
 *   2. contextInfo.groupMentionedMessage
 *   3. contextInfo.mentionedJid containing @g.us  ← modern Baileys
 */
function isGroupMentionMsg(msg) {
  if (!msg?.message) return false;
  const m   = msg.message;
  const ctx = resolveContext(msg);
  return !!(
    m.groupMentionedMessage                           ||
    ctx?.groupMentionedMessage                        ||
    ctx?.mentionedJid?.some(j => j.endsWith('@g.us'))
  );
}

// ── Download helper with reupload fallback ─────────────────────────────────────
async function safeDownload(sock, fakeMsg) {
  try {
    return await downloadMediaMessage(
      fakeMsg, 'buffer', {},
      { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
    );
  } catch (_) {
    return downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
  }
}

// ── Media antidelete restore ────────────────────────────────────────────────────
async function _restoreDeletedMessage(sock, deletedId, dest) {
  const cached = msgCache.get(deletedId);
  if (!cached) return;

  const prefix = (cached.from && cached.from !== dest)
    ? `\n📍 _From: ${cached.from}_` : '';
  const m = cached.fullMsg?.message;

  if (m && cached.fullMsg) {
    const mediaType =
      m.imageMessage    ? 'image'    :
      m.videoMessage    ? 'video'    :
      m.audioMessage    ? 'audio'    :
      m.documentMessage ? 'document' :
      m.stickerMessage  ? 'sticker'  : null;

    if (mediaType) {
      try {
        const buf = await safeDownload(sock, cached.fullMsg);
        if (buf && buf.length > 0) {
          switch (mediaType) {
            case 'image':
              await sock.sendMessage(dest, {
                image:   buf,
                caption: `🗑️ *Deleted image*${prefix}\n${m.imageMessage.caption || ''}`.trim(),
              });
              break;
            case 'video':
              await sock.sendMessage(dest, {
                video:   buf,
                caption: `🗑️ *Deleted video*${prefix}\n${m.videoMessage.caption || ''}`.trim(),
              });
              break;
            case 'audio':
              await sock.sendMessage(dest, {
                audio:    buf,
                mimetype: m.audioMessage.mimetype || 'audio/ogg; codecs=opus',
                ptt:      !!m.audioMessage.ptt,
              });
              await sock.sendMessage(dest, { text: `🗑️ *Deleted audio*${prefix}` });
              break;
            case 'document':
              await sock.sendMessage(dest, {
                document: buf,
                mimetype: m.documentMessage.mimetype || 'application/octet-stream',
                fileName: m.documentMessage.fileName || 'deleted_document',
                caption:  `🗑️ *Deleted document*${prefix}`,
              });
              break;
            case 'sticker':
              await sock.sendMessage(dest, { sticker: buf });
              await sock.sendMessage(dest, { text: `🗑️ *Deleted sticker*${prefix}` });
              break;
          }
          msgCache.del(deletedId);
          return;
        }
      } catch (e) {
        console.error('[AntiDelete] Media restore failed:', e.message);
        // Fall through to text fallback
      }
    }
  }

  // Text fallback — always works
  await sock.sendMessage(dest, {
    text: `🗑️ *Deleted Message*${prefix}\n\n_"${cached.body}"_`,
  });
  msgCache.del(deletedId);
}

// ── Reaction message handler ───────────────────────────────────────────────────
/**
 * Handles message.reactionMessage — modern WhatsApp sends emoji reactions here.
 *
 * Two secret features triggered by reaction:
 *   A. View-once reveal: owner reacted to a cached view-once message
 *   B. Status save: owner reacted to a status@broadcast message
 */
async function _handleReaction(sock, msg, sessionOwnerPhone) {
  const react = msg.message?.reactionMessage;
  if (!react) return;

  const reactedToId  = react.key?.id;
  const reactedToJid = react.key?.remoteJid;
  const reactorJid   = msg.key.participant || msg.key.remoteJid;
  const ownerJid     = selfJid(sessionOwnerPhone);

  // Only process owner's reactions for secret features
  if (!msg.key.fromMe) return;
  if (!reactedToId)    return;

  const dest = ownerJid;

  // ── A. View-once reveal via reaction ──────────────────────────────────────
  const cachedVO = msgCache.get(reactedToId);
  if (cachedVO?.fullMsg) {
    const m = cachedVO.fullMsg.message;
    const voInner = unwrapViewOnce(cachedVO.fullMsg);
    const plainMedia = !voInner && (m?.imageMessage || m?.videoMessage || m?.audioMessage)
      ? m : null;
    const inner = voInner || plainMedia;

    if (inner) {
      const fakeMsg = {
        key: {
          remoteJid:   reactedToJid || cachedVO.from || dest,
          id:          reactedToId,
          participant: react.key?.participant || null,
          fromMe:      false,
        },
        message: inner,
      };
      // Use vvCmd.handleSecret which already has full download + send logic
      await vvCmd.handleSecret(sock, fakeMsg, dest);
      return;
    }
  }

  // ── B. Status save via reaction ────────────────────────────────────────────
  // Owner reacted to a status → fetch status content from cache and save
  if (reactedToJid === 'status@broadcast' || cachedVO?.from === 'status@broadcast') {
    if (cachedVO?.fullMsg) {
      await statusSaver.handle(sock, cachedVO.fullMsg, sessionOwnerPhone);
    }
  }
}

// ── Main message handler ───────────────────────────────────────────────────────
async function handleMessages({ session, payload }) {
  if (payload.type !== 'notify') return;

  const sock              = session.sock;
  const messages          = payload.messages || [];
  const state             = session.state    || {};
  const sessionOwnerPhone = session.phoneNumber || getAdminNumber();
  const connectedAt       = session.connectedAt || 0;

  for (const msg of messages) {
    try {
      if (!msg.message) continue;

      const from = msg.key.remoteJid;
      if (!from) continue;

      // Drop pre-connection history replay (15s grace window)
      const msgTsMs = (msg.messageTimestamp || 0) * 1000;
      if (connectedAt > 0 && msgTsMs > 0 && msgTsMs < connectedAt - 15_000) continue;

      // ── reactionMessage ────────────────────────────────────────────────────
      // Modern WA sends emoji reactions as reactionMessage — NOT extendedTextMessage.
      // Must be processed BEFORE the text body extraction below.
      if (isReaction(msg)) {
        if (msg.key.fromMe) {
          // Secret: owner's reaction → VO reveal or status save
          await _handleReaction(sock, msg, sessionOwnerPhone);
        }
        continue; // reactions are not commands
      }

      // ── Protocol messages (antidelete / antiedit inline in upsert) ─────────
      const proto = msg.message?.protocolMessage;
      if (proto != null) {
        if (proto.type === 0 && state.antidelete) {
          // REVOKE — message deleted
          const deletedId = proto.key?.id;
          if (deletedId) await _restoreDeletedMessage(sock, deletedId, selfJid(sessionOwnerPhone));
        }
        if (proto.type === 14 && state.antiedit) {
          // MESSAGE_EDIT
          const originalId = proto.key?.id;
          const newText    = extractEditedText(proto);
          if (originalId && newText) {
            const originalText = editCache.get(originalId);
            if (originalText && newText !== originalText) {
              const chatJid = proto.key?.remoteJid || from;
              const dest    = selfJid(sessionOwnerPhone);
              const label   = chatJid !== dest ? `\n📍 _From: ${chatJid}_\n` : '\n';
              await sock.sendMessage(dest, {
                text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
              });
            }
            editCache.set(originalId, newText);
          }
        }
        continue;
      }

      // ── editedMessage inline (some Baileys builds) ─────────────────────────
      if (msg.message?.editedMessage) {
        if (state.antiedit) {
          const em = msg.message.editedMessage;
          const originalId = em.key?.id;
          const inner = em.message;
          const newText =
            inner?.conversation              ||
            inner?.extendedTextMessage?.text ||
            inner?.imageMessage?.caption     ||
            inner?.videoMessage?.caption     ||
            '';
          if (originalId && newText) {
            const originalText = editCache.get(originalId);
            if (originalText && newText !== originalText) {
              const chatJid = em.key?.remoteJid || from;
              const dest    = selfJid(sessionOwnerPhone);
              const label   = chatJid !== dest ? `\n📍 _From: ${chatJid}_\n` : '\n';
              await sock.sendMessage(dest, {
                text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
              });
            }
            editCache.set(originalId, newText);
          }
        }
        continue;
      }

      const isGroup = from.endsWith('@g.us');
      const sender  = isGroup ? (msg.key.participant || '') : from;
      // Use centralized extractText — works for ALL message types
      const body    = extractText(msg);
      const isCmd   = body.startsWith('*');

      // ── fromMe — sent by the linked phone ─────────────────────────────────
      if (msg.key.fromMe) {
        // resolveContext() covers ALL message types for status/VO detection
        const fmCtx = resolveContext(msg);

        // Status save: owner replied to a status (any message type)
        if (from === 'status@broadcast' || fmCtx?.remoteJid === 'status@broadcast') {
          await statusSaver.handle(sock, msg, sessionOwnerPhone);
        }

        // Secret view-once reveal: emoji-only reply to a media/VO message
        if (!isCmd && fmCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
          const qm       = fmCtx.quotedMessage;
          const voInner  = unwrapViewOnce({ message: qm });
          const hasMedia = !!(voInner || qm.imageMessage || qm.videoMessage || qm.audioMessage);
          if (hasMedia) {
            const inner   = voInner || qm;
            const fakeMsg = {
              key: {
                remoteJid:   from,
                id:          fmCtx.stanzaId || msg.key.id,
                participant: null,
                fromMe:      false,
              },
              message: inner,
            };
            await vvCmd.handleSecret(sock, fakeMsg, selfJid(sessionOwnerPhone));
            continue;
          }
        }

        if (!isCmd) continue;
      }

      // ── status@broadcast — auto-reply feature ──────────────────────────────
      if (from === 'status@broadcast') {
        if (typeof statusreplyCmd?.handleAutoReply === 'function') {
          await statusreplyCmd.handleAutoReply(sock, msg, state);
        }
        continue;
      }

      // ── Secret view-once reveal (non-owner emoji reply) ────────────────────
      {
        const replyCtx = resolveContext(msg);
        if (!isCmd && replyCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
          const qm       = replyCtx.quotedMessage;
          const voInner  = unwrapViewOnce({ message: qm });
          const hasMedia = !!(voInner || qm.imageMessage || qm.videoMessage || qm.audioMessage);
          if (hasMedia) {
            const inner   = voInner || qm;
            const fakeMsg = {
              key: {
                remoteJid:   from,
                id:          replyCtx.stanzaId || msg.key.id,
                participant: sender,
                fromMe:      false,
              },
              message: inner,
            };
            await vvCmd.handleSecret(sock, fakeMsg, selfJid(sessionOwnerPhone));
            continue;
          }
        }
      }

      // ── Cache all messages for antidelete / antiedit ───────────────────────
      const label = messageLabel(msg);
      if (label) {
        msgCache.set(msg.key.id,  { from, body: label, fullMsg: msg });
        editCache.set(msg.key.id, label);
      }

      // ── Rolling group buffer (summary command) ─────────────────────────────
      if (isGroup && !isCmd && !msg.key.fromMe && body) {
        msgBuffer.add(from, cleanNum(sender), body);
      }

      // ── Per-group message counts (listactive / topchat) ───────────────────
      if (isGroup && sender) {
        const num = cleanNum(sender);
        if (!sessionMsgCounts.has(from)) sessionMsgCounts.set(from, new Map());
        const gc = sessionMsgCounts.get(from);
        gc.set(num, (gc.get(num) || 0) + 1);
        addMsgCount(from, num);
      }

      // ── Auto React ────────────────────────────────────────────────────────
      // shouldReact() now checks: not a reaction, not self, per-chat cooldown
      if (state.autoreact && !isCmd && !msg.key.fromMe &&
          typeof autoreactCmd?.shouldReact === 'function' &&
          autoreactCmd.shouldReact(msg, from)) {
        try {
          await sock.sendMessage(from, {
            react: { text: autoreactCmd.randomEmoji(), key: msg.key },
          });
          if (typeof autoreactCmd.markCooldown === 'function') {
            autoreactCmd.markCooldown(from);
          }
        } catch (_) {}
      }

      // ── Group enforcement (antigroupmention, antilink) ─────────────────────
      if (isGroup && sender && !isCmd) {
        const gs = getGroupSettings(from);

        if (gs.antigroupmention && isGroupMentionMsg(msg)) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, id: msg.key.id, participant: sender, fromMe: false },
            });
          } catch (e) { console.error('[AntiGroupMention] Delete failed:', e.message); }
          const num   = cleanNum(sender);
          const count = addWarning(from, num);
          if (count >= 5) {
            await sock.sendMessage(from, {
              text: `🚨 @${num} has been *removed* for repeatedly mentioning groups!`,
              mentions: [sender],
            });
            try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
            resetWarnings(from, num);
          } else {
            await sock.sendMessage(from, {
              text: `🔕 @${num}, group mentions are *not allowed* here!\n⚠️ Warning *${count}/5* — ${5 - count} more before removal.`,
              mentions: [sender],
            });
          }
          continue;
        }

        if (gs.antilink && LINK_RE.test(body)) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, id: msg.key.id, participant: sender, fromMe: false },
            });
          } catch (e) { console.error('[Antilink] Delete failed:', e.message); }
          const num   = cleanNum(sender);
          const count = addWarning(from, num);
          if (count >= 5) {
            await sock.sendMessage(from, {
              text: `🚨 @${num} has been *removed* for sending links repeatedly!`,
              mentions: [sender],
            });
            try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
            resetWarnings(from, num);
          } else {
            await sock.sendMessage(from, {
              text: `⛔ @${num}, links are *not allowed* here!\n⚠️ Warning *${count}/5* — ${5 - count} more before removal.`,
              mentions: [sender],
            });
          }
          continue;
        }
      }

      if (!isCmd) continue;

      // ── Command dedup ──────────────────────────────────────────────────────
      if (!msg.key.fromMe) {
        const dk = `cmd:${msg.key.id}`;
        if (cmdDedup.get(dk)) continue;
        cmdDedup.set(dk, true);
      }

      const effectiveSender = msg.key.fromMe
        ? selfJid(sessionOwnerPhone)
        : (sender || from);

      const access = checkAccess(effectiveSender, sessionOwnerPhone);
      if (!access.allowed) {
        await sock.sendMessage(from, { text: denyMsg(access.reason) });
        continue;
      }

      const parts  = body.trim().slice(1).split(/\s+/);
      const cmd    = parts[0].toLowerCase();
      const args   = parts.slice(1);
      const argStr = args.join(' ').trim();

      const ctx = {
        sock, msg, from,
        sender: effectiveSender,
        args, argStr,
        isGroup,
        isAdmin: access.isAdmin,
        sessionOwnerPhone,
        state,
        sessionMsgCounts,
      };

      // ── Auto Typing — fire-and-forget ONLY, never await ───────────────────
      // simulateTyping does: composing → 600-1400ms → paused
      // The command starts executing immediately in parallel.
      if (state.autotyping && typeof autotypingCmd?.simulateTyping === 'function') {
        autotypingCmd.simulateTyping(sock, from); // intentionally NOT awaited
      }

      // ── Command dispatch ───────────────────────────────────────────────────
      try {
        switch (cmd) {
          // Group management
          case 'antigroupmention':   await antigroupmentionCmd.handle(ctx); break;
          case 'antilink':           await antilinkCmd.handle(ctx);         break;
          case 'approve':            await approveCmd.handle(ctx);          break;
          case 'approveall':         await approveallCmd.handle(ctx);       break;
          case 'close':              await closeCmd.handle(ctx);            break;
          case 'closetime':          await closetimeCmd.handle(ctx);        break;
          case 'demote':             await demoteCmd.handle(ctx);           break;
          case 'disapproveall':      await disapproveallCmd.handle(ctx);    break;
          case 'goodbye':            await goodbyeCmd.handle(ctx);          break;
          case 'hidetag':            await hidetagCmd.handle(ctx);          break;
          case 'kick':               await kickCmd.handle(ctx);             break;
          case 'listactive':         await listactiveCmd.handle(ctx);       break;
          case 'open':               await openCmd.handle(ctx);             break;
          case 'opentime':           await opentimeCmd.handle(ctx);         break;
          case 'promote':            await promoteCmd.handle(ctx);          break;
          case 'resetlink':          await resetlinkCmd.handle(ctx);        break;
          case 'resetwarn':          await resetwarnCmd.handle(ctx);        break;
          case 'tagall':             await tagallCmd.handle(ctx);           break;
          case 'warn':               await warnCmd.handle(ctx);             break;
          case 'welcome':            await welcomeCmd.handle(ctx);          break;
          // Tools
          case 'block':              await blockCmd.handle(ctx);            break;
          case 'delete':             await deleteCmd.handle(ctx);           break;
          case 'getpp':              await getppCmd.handle(ctx);            break;
          case 'helpers':            await helpersCmd.handle(ctx);          break;
          case 'listblocked':        await listblockedCmd.handle(ctx);      break;
          case 'resetcount':         await resetcountCmd.handle(ctx);       break;
          case 'sticker': case 's':  await stickerCmd.handle(ctx);          break;
          case 'togstatus':          await togstatusCmd.handle(ctx);        break;
          case 'unblock':            await unblockCmd.handle(ctx);          break;
          case 'vv':                 await vvCmd.handle(ctx);               break;
          // v2 tools
          case 'ai':                 await aiCmd.handle(ctx);               break;
          case 'summary':            await summaryCmd.handle(ctx);          break;
          case 'ship':               await shipCmd.handle(ctx);             break;
          case 'topchat':            await topchatCmd.handle(ctx);          break;
          case 'toimg':              await toimgCmd.handle(ctx);            break;
          case 'tomp3':              await tomp3Cmd.handle(ctx);            break;
          case 'tts':                await ttsCmd.handle(ctx);              break;
          case 'runtime':            await runtimeCmd.handle(ctx);          break;
          case 'backup':             await backupCmd.handle(ctx);           break;
          // Settings
          case 'alwaysonline':       await alwaysonlineCmd.handle(ctx);     break;
          case 'anticall':           await anticallCmd.handle(ctx);         break;
          case 'antidelete':         await antideleteCmd.handle(ctx);       break;
          case 'antiedit':           await antieditCmd.handle(ctx);         break;
          case 'autoreact':          await autoreactCmd.handle(ctx);        break;
          case 'autotyping':         await autotypingCmd.handle(ctx);       break;
          case 'statusreply':        await statusreplyCmd.handle(ctx);      break;
          case 'botstatus':          await botstatusCmd.handle(ctx);        break;
          case 'menu':               await menuCmd.handle(ctx);             break;
          case 'mode':               await modeCmd.handle(ctx);             break;
          case 'ping':               await pingCmd.handle(ctx);             break;
          default: break; // unknown command — silently ignore
        }
      } catch (cmdErr) {
        console.error(`[Cmd:${cmd}] Error:`, cmdErr.message, cmdErr.stack?.split('\n')[1] || '');
        try {
          await sock.sendMessage(from, {
            text: `❌ _Command failed internally. Please try again._\n_${cmdErr.message}_`,
          });
        } catch {}
      }
    } catch (outerErr) {
      console.error('[Messages] Pipeline error:', outerErr.message, outerErr.stack?.split('\n')[1] || '');
    }
  }
}

// ── handleMessageDelete (messages.delete event) ────────────────────────────────
async function handleMessageDelete(sock, update, state, session) {
  if (!state?.antidelete) return;
  try {
    const sessionOwnerPhone = session?.phoneNumber || getAdminNumber();
    const dest              = selfJid(sessionOwnerPhone);
    const keys              = update?.keys || (Array.isArray(update) ? update : []);
    for (const key of keys) {
      if (key?.id) await _restoreDeletedMessage(sock, key.id, dest);
    }
  } catch (e) { console.error('[AntiDelete/delete]', e.message); }
}

// ── handleMessageEdit (messages.update event) ─────────────────────────────────
// Handles BOTH delete (REVOKE, type 0) and edit (MESSAGE_EDIT, type 14).
// Modern Baileys primarily delivers these through messages.update.
async function handleMessageEdit(sock, updates, state, session) {
  if (!state) return;
  try {
    const sessionOwnerPhone = session?.phoneNumber || getAdminNumber();
    const dest              = selfJid(sessionOwnerPhone);

    for (const { key, update } of (updates || [])) {
      try {
        const proto = update?.message?.protocolMessage;

        // REVOKE (type 0) — delete via messages.update
        if (proto?.type === 0 && state.antidelete) {
          const deletedId = proto.key?.id || key.id;
          if (deletedId) await _restoreDeletedMessage(sock, deletedId, dest);
          continue;
        }

        // MESSAGE_EDIT (type 14) — edit via messages.update
        if (proto?.type === 14 && state.antiedit) {
          const originalId = proto.key?.id || key.id;
          const newText    = extractEditedText(proto);
          if (originalId && newText) {
            const originalText = editCache.get(originalId);
            if (originalText && newText !== originalText) {
              const chatJid = proto.key?.remoteJid || key.remoteJid;
              const label   = chatJid && chatJid !== dest ? `\n📍 _From: ${chatJid}_\n` : '\n';
              await sock.sendMessage(dest, {
                text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
              });
            }
            editCache.set(originalId, newText);
          }
          continue;
        }

        // Fallback: update.message contains the edit inline
        if (state.antiedit && !proto && update?.message) {
          const jid = key.remoteJid;
          if (!jid) continue;
          const original = editCache.get(key.id);
          if (!original) continue;
          const mu     = update.message;
          const edited =
            mu?.editedMessage?.message?.conversation                     ||
            mu?.editedMessage?.message?.extendedTextMessage?.text        ||
            mu?.editedMessage?.message?.imageMessage?.caption            ||
            mu?.editedMessage?.message?.videoMessage?.caption            ||
            mu?.protocolMessage?.editedMessage?.conversation             ||
            mu?.protocolMessage?.editedMessage?.extendedTextMessage?.text||
            mu?.conversation                                             ||
            mu?.extendedTextMessage?.text                                ||
            '';
          if (!edited || edited === original) continue;
          const label = jid !== dest ? `\n📍 _From: ${jid}_\n` : '\n';
          await sock.sendMessage(dest, {
            text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${original}"_\n\n🔄 *Edited to:*\n_"${edited}"_`,
          });
          editCache.set(key.id, edited);
        }
      } catch (innerErr) {
        console.error('[MessagesUpdate] Inner:', innerErr.message);
      }
    }
  } catch (e) { console.error('[MessagesUpdate]', e.message); }
}

// ── handleCall ─────────────────────────────────────────────────────────────────
async function handleCall(sock, calls, state) {
  if (!state?.anticall) return;
  for (const call of (calls || [])) {
    try {
      if (call.status === 'offer') {
        await sock.rejectCall(call.id, call.from);
        await sock.sendMessage(call.from, {
          text: '📵 *Calls are not allowed!* Please send a message instead. 🙏',
        });
      }
    } catch (e) { console.error('[AntiCall]', e.message); }
  }
}

module.exports = {
  handleMessages,
  handleMessageDelete,
  handleMessageEdit,
  handleCall,
  sessionMsgCounts,
};
