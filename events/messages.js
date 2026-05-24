'use strict';

/**
 * events/messages.js — BOTIFY X core message handler.
 *
 * KEY FIXES IN THIS VERSION:
 *  1. getContextInfo()  — unified context resolver for ALL message types
 *                         (extendedText / image / video / audio / document / sticker)
 *  2. antidelete        — full media restoration (image/video/audio/document/sticker)
 *                         using downloadMediaMessage + reuploadRequest fallback
 *  3. antiedit          — expanded detection via messages.update REVOKE/EDIT paths
 *  4. antigroupmention  — now detects contextInfo.mentionedJid @g.us entries
 *  5. fromMe block      — uses getContextInfo() so status-save works for all
 *                         media types (image status, video status, etc.)
 *  6. viewOnce reveal   — uses getContextInfo() across all message types
 *  7. handleMessageEdit — now also handles REVOKE (type 0) from messages.update
 *  8. autotyping        — fire-and-forget (120ms yield only); never blocks loop
 *  9. ffmpeg commands   — toimg/tomp3/sticker are fire-and-forget; loop never waits
 * 10. Priority: session-owner (fromMe) commands bypass the serialisation queue
 */

const NodeCache = require('node-cache');
const { downloadMediaMessage }      = require('@whiskeysockets/baileys');
const { checkAccess, denyMsg }      = require('../utils/access');
const { getGroupSettings, addWarning, resetWarnings, addMsgCount } = require('../utils/dataManager');
const { getAdminNumber }            = require('../utils/botState');
const msgBuffer                     = require('../utils/msgBuffer');

// ── Existing command handlers ──────────────────────────────────────────────────
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

// ── v2 command handlers ────────────────────────────────────────────────────────
const aiCmd          = require('../commands/ai');
const summaryCmd     = require('../commands/summary');
const autoreactCmd   = require('../commands/autoreact');
const statusreplyCmd = require('../commands/statusreply');
const shipCmd        = require('../commands/ship');
const topchatCmd     = require('../commands/topchat');
const toimgCmd       = require('../commands/toimg');
const tomp3Cmd       = require('../commands/tomp3');
const ttsCmd         = require('../commands/tts');
const runtimeCmd     = require('../commands/runtime');
const backupCmd      = require('../commands/backup');
const autotypingCmd  = require('../commands/autotyping');

// ── Caches ─────────────────────────────────────────────────────────────────────
// msgCache stores { from, body, fullMsg } — fullMsg enables media antidelete
const msgCache  = new NodeCache({ stdTTL: 600,  checkperiod: 60  });
const editCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const cmdDedup  = new NodeCache({ stdTTL: 30,   checkperiod: 10  });

// In-memory per-group message counts (used by *listactive and *topchat)
const sessionMsgCounts = new Map();

// ── Silent logger for downloadMediaMessage ────────────────────────────────────
const SLOG = {
  level: 'silent',
  info() {}, error() {}, warn() {}, debug() {}, trace() {},
  child() { return this; },
};

// ── Regex helpers ──────────────────────────────────────────────────────────────
const LINK_RE  = /(https?:\/\/\S+|chat\.whatsapp\.com\/\S+)/i;
const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u;

// ── Text extraction ────────────────────────────────────────────────────────────
function extractBody(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation                                           ||
    m.extendedTextMessage?.text                              ||
    m.imageMessage?.caption                                  ||
    m.videoMessage?.caption                                  ||
    m.documentMessage?.caption                               ||
    m.buttonsResponseMessage?.selectedButtonId               ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId  ||
    m.templateButtonReplyMessage?.selectedId                 ||
    ''
  );
}

/**
 * Unified context resolver — returns contextInfo regardless of which
 * message type it's attached to. Fixes status-save and view-once reveal
 * failing on media replies (e.g. replying with "❤️" to an image status).
 */
function getContextInfo(msg) {
  const m = msg?.message;
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo        ||
    m.videoMessage?.contextInfo        ||
    m.audioMessage?.contextInfo        ||
    m.documentMessage?.contextInfo     ||
    m.stickerMessage?.contextInfo      ||
    null
  );
}

function cleanNum(jid) {
  return (jid || '').split('@')[0].split(':')[0];
}

function selfJid(sessionOwnerPhone) {
  return String(sessionOwnerPhone || '').replace(/\D/g, '') + '@s.whatsapp.net';
}

/**
 * Unwrap a view-once or plain media message into a downloadable fake message.
 * Supports: viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension,
 *           image, video, audio (for audio view-once notes).
 */
function fakeVoMsg(key, qm) {
  const inner =
    qm.viewOnceMessage?.message            ||
    qm.viewOnceMessageV2?.message          ||
    qm.viewOnceMessageV2Extension?.message;
  if (inner) return { key, message: inner };
  if (qm.imageMessage || qm.videoMessage || qm.audioMessage) {
    return { key, message: qm };
  }
  return null;
}

function messageLabel(msg) {
  const m = msg.message;
  if (!m) return '';
  const body = extractBody(msg);
  if (body) return body;
  if (m.imageMessage)        return '[Image]';
  if (m.videoMessage)        return '[Video]';
  if (m.audioMessage)        return '[Audio]';
  if (m.documentMessage)     return `[Document: ${m.documentMessage.fileName || 'file'}]`;
  if (m.stickerMessage)      return '[Sticker]';
  if (m.contactMessage)      return '[Contact]';
  if (m.locationMessage)     return '[Location]';
  if (m.liveLocationMessage) return '[Live Location]';
  if (m.pollCreationMessage) return `[Poll: ${m.pollCreationMessage.name || ''}]`;
  if (
    m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension
  ) return '[View Once]';
  return '[Media]';
}

function extractEditedText(proto) {
  const ec = proto?.editedMessage;
  if (!ec) return '';
  return (
    ec.conversation                         ||
    ec.extendedTextMessage?.text            ||
    ec.imageMessage?.caption                ||
    ec.videoMessage?.caption                ||
    ec.documentMessage?.caption             ||
    ec.message?.conversation                ||
    ec.message?.extendedTextMessage?.text   ||
    ec.message?.imageMessage?.caption       ||
    ec.message?.videoMessage?.caption       ||
    ''
  );
}

/**
 * antigroupmention detection — covers three Baileys formats:
 *  1. msg.message.groupMentionedMessage (dedicated field)
 *  2. contextInfo.groupMentionedMessage (inside contextInfo)
 *  3. contextInfo.mentionedJid[] containing a @g.us JID  ← NEW in modern Baileys
 */
function isGroupMentionMsg(msg) {
  if (!msg?.message) return false;
  const m   = msg.message;
  const ctx = getContextInfo(msg);
  return !!(
    m.groupMentionedMessage                            ||
    ctx?.groupMentionedMessage                         ||
    ctx?.mentionedJid?.some(j => j.endsWith('@g.us'))
  );
}

// ── Media antidelete helper ────────────────────────────────────────────────────
/**
 * Attempt to restore a deleted message by its cache ID.
 * For media messages: re-download and forward to the owner's "Message Yourself".
 * Falls back to text description if media download fails.
 *
 * @param {object} sock
 * @param {string} deletedId  - the msg.key.id of the deleted message
 * @param {string} dest       - owner's self-JID (destination for restored content)
 */
async function _restoreDeletedMessage(sock, deletedId, dest) {
  const cached = msgCache.get(deletedId);
  if (!cached) return;

  const prefix = cached.from && cached.from !== dest
    ? `\n📍 _From: ${cached.from}_` : '';
  const m = cached.fullMsg?.message;

  // Attempt media restoration
  if (m && cached.fullMsg) {
    const mediaType =
      m.imageMessage    ? 'image'    :
      m.videoMessage    ? 'video'    :
      m.audioMessage    ? 'audio'    :
      m.documentMessage ? 'document' :
      m.stickerMessage  ? 'sticker'  : null;

    if (mediaType) {
      try {
        const buf = await downloadMediaMessage(
          cached.fullMsg, 'buffer', {},
          { logger: SLOG, reuploadRequest: sock.updateMediaMessage },
        );

        if (buf && buf.length > 0) {
          if (mediaType === 'image') {
            await sock.sendMessage(dest, {
              image: buf,
              caption: `🗑️ *Deleted image*${prefix}\n${m.imageMessage.caption || ''}`.trim(),
            });
          } else if (mediaType === 'video') {
            await sock.sendMessage(dest, {
              video: buf,
              caption: `🗑️ *Deleted video*${prefix}\n${m.videoMessage.caption || ''}`.trim(),
            });
          } else if (mediaType === 'audio') {
            await sock.sendMessage(dest, {
              audio:    buf,
              mimetype: m.audioMessage.mimetype || 'audio/ogg; codecs=opus',
              ptt:      !!m.audioMessage.ptt,
            });
            await sock.sendMessage(dest, {
              text: `🗑️ *Deleted audio*${prefix}`,
            });
          } else if (mediaType === 'document') {
            await sock.sendMessage(dest, {
              document: buf,
              mimetype: m.documentMessage.mimetype || 'application/octet-stream',
              fileName: m.documentMessage.fileName || 'deleted_document',
              caption:  `🗑️ *Deleted document*${prefix}`,
            });
          } else if (mediaType === 'sticker') {
            await sock.sendMessage(dest, { sticker: buf });
            await sock.sendMessage(dest, { text: `🗑️ *Deleted sticker*${prefix}` });
          }
          msgCache.del(deletedId);
          return; // media sent — done
        }
      } catch (e) {
        console.error('[AntiDelete] Media restore failed for', mediaType, '—', e.message);
        // Fall through to text fallback
      }
    }
  }

  // Text fallback — always works even when media download fails
  await sock.sendMessage(dest, {
    text: `🗑️ *Deleted Message*${prefix}\n\n_"${cached.body}"_`,
  });
  msgCache.del(deletedId);
}

// ── Main message handler ───────────────────────────────────────────────────────
async function handleMessages({ session, payload }) {
  if (payload.type !== 'notify') return;

  const sock              = session.sock;
  const messages          = payload.messages || [];
  const state             = session.state    || {};
  const sessionOwnerPhone = session.phoneNumber || getAdminNumber();
  const connectedAt       = session.connectedAt  || 0;

  for (const msg of messages) {
    try {
      if (!msg.message) continue;

      const from = msg.key.remoteJid;
      if (!from) continue;

      // Drop pre-connection history replay (15s grace window)
      const msgTimestampMs = (msg.messageTimestamp || 0) * 1000;
      if (connectedAt > 0 && msgTimestampMs > 0 && msgTimestampMs < connectedAt - 15_000) {
        continue;
      }

      // ── Protocol messages (antidelete / antiedit via messages.upsert) ─────
      // NOTE: Modern Baileys also sends these via messages.update (handled in
      // handleMessageEdit below). Both paths are covered.
      const proto = msg.message?.protocolMessage;

      if (proto !== undefined && proto !== null) {
        // REVOKE (type 0) — message was deleted
        if (proto.type === 0) {
          if (state.antidelete) {
            const deletedId = proto.key?.id;
            if (deletedId) {
              const dest = selfJid(sessionOwnerPhone);
              await _restoreDeletedMessage(sock, deletedId, dest);
            }
          }
          continue;
        }

        // MESSAGE_EDIT (type 14) — message was edited
        if (proto.type === 14) {
          if (state.antiedit) {
            const originalId = proto.key?.id;
            const newText    = extractEditedText(proto);
            if (originalId && newText) {
              const originalText = editCache.get(originalId);
              if (originalText && newText !== originalText) {
                const dest    = selfJid(sessionOwnerPhone);
                const chatJid = proto.key?.remoteJid || from;
                const label   = chatJid && chatJid !== dest
                  ? `\n📍 _From: ${chatJid}_\n` : '\n';
                await sock.sendMessage(dest, {
                  text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
                });
              }
              editCache.set(originalId, newText);
            }
          }
          continue;
        }

        continue; // all other protocol types = WA housekeeping
      }

      // ── Alternative edit format (some Baileys / WA client combinations) ───
      const editedMsg = msg.message?.editedMessage;
      if (editedMsg) {
        if (state.antiedit) {
          const originalId = editedMsg.key?.id;
          const em         = editedMsg.message;
          const newText    =
            em?.conversation               ||
            em?.extendedTextMessage?.text  ||
            em?.imageMessage?.caption      ||
            em?.videoMessage?.caption      ||
            '';
          if (originalId && newText) {
            const originalText = editCache.get(originalId);
            if (originalText && newText !== originalText) {
              const dest    = selfJid(sessionOwnerPhone);
              const chatJid = editedMsg.key?.remoteJid || from;
              const label   = chatJid && chatJid !== dest
                ? `\n📍 _From: ${chatJid}_\n` : '\n';
              await sock.sendMessage(dest, {
                text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
              });
            }
            editCache.set(originalId, newText);
          }
        }
        continue;
      }

      const isGroup   = from.endsWith('@g.us');
      const sender    = isGroup ? (msg.key.participant || '') : from;
      const body      = extractBody(msg);
      const isCommand = body.startsWith('*');

      // ── fromMe — messages sent by the linked phone ────────────────────────
      if (msg.key.fromMe) {
        // Use getContextInfo() — covers text, image, video, audio replies to statuses
        const fmCtx = getContextInfo(msg);

        // Status auto-save: owner replied to a status
        if (fmCtx?.remoteJid === 'status@broadcast' || from === 'status@broadcast') {
          await statusSaver.handle(sock, msg, sessionOwnerPhone);
        }

        // Secret view-once reveal: owner replied with emoji-only to a media message
        if (!isCommand && fmCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
          const qm = fmCtx.quotedMessage;
          const hasMedia = !!(
            qm.viewOnceMessage || qm.viewOnceMessageV2 || qm.viewOnceMessageV2Extension ||
            qm.imageMessage    || qm.videoMessage       || qm.audioMessage
          );
          if (hasMedia) {
            const fake = fakeVoMsg(
              {
                remoteJid:   from,
                id:          fmCtx.stanzaId || msg.key.id,
                participant: null,
                fromMe:      false,
              },
              qm,
            );
            if (fake) await vvCmd.handleSecret(sock, fake, selfJid(sessionOwnerPhone));
            continue;
          }
        }

        if (!isCommand) continue;
      }

      // ── Status@broadcast — auto-reply feature (v2) ────────────────────────
      if (from === 'status@broadcast') {
        if (typeof statusreplyCmd?.handleAutoReply === 'function') {
          await statusreplyCmd.handleAutoReply(sock, msg, state);
        }
        continue;
      }

      // ── Secret view-once reveal (non-owner emoji reply) ───────────────────
      // getContextInfo() ensures this works whether the reply is text, image, etc.
      const replyCtx = getContextInfo(msg);
      if (!isCommand && replyCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
        const qm = replyCtx.quotedMessage;
        const hasMedia = !!(
          qm.viewOnceMessage || qm.viewOnceMessageV2 || qm.viewOnceMessageV2Extension ||
          qm.imageMessage    || qm.videoMessage       || qm.audioMessage
        );
        if (hasMedia) {
          const fake = fakeVoMsg(
            {
              remoteJid:   from,
              id:          replyCtx.stanzaId || msg.key.id,
              participant: sender,
              fromMe:      false,
            },
            qm,
          );
          if (fake) await vvCmd.handleSecret(sock, fake, selfJid(sessionOwnerPhone));
          continue;
        }
      }

      // ── Cache messages for antidelete / antiedit ──────────────────────────
      // Store fullMsg so _restoreDeletedMessage can re-download media.
      const label = messageLabel(msg);
      if (label) {
        msgCache.set(msg.key.id,  { from, body: label, fullMsg: msg });
        editCache.set(msg.key.id, label);
      }

      // ── Rolling group buffer (for *summary) ───────────────────────────────
      if (isGroup && !isCommand && !msg.key.fromMe && body) {
        msgBuffer.add(from, cleanNum(sender), body);
      }

      // ── Per-group message counts (for *listactive / *topchat) ─────────────
      if (isGroup && sender) {
        const num = cleanNum(sender);
        if (!sessionMsgCounts.has(from)) sessionMsgCounts.set(from, new Map());
        const gc = sessionMsgCounts.get(from);
        gc.set(num, (gc.get(num) || 0) + 1);
        addMsgCount(from, num);
      }

      // ── Auto React (v2) ────────────────────────────────────────────────────
      if (state.autoreact && !isCommand && !msg.key.fromMe &&
          typeof autoreactCmd?.shouldReact === 'function' && autoreactCmd.shouldReact()) {
        try {
          await sock.sendMessage(from, {
            react: { text: autoreactCmd.randomEmoji(), key: msg.key },
          });
        } catch (_) {}
      }

      // ── Group enforcement (antigroupmention, antilink) ─────────────────────
      if (isGroup && sender && !isCommand) {
        const gs = getGroupSettings(from);

        // Antigroupmention — expanded to catch mentionedJid @g.us (modern Baileys)
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
              text: `🔕 @${num}, group mentions are *not allowed* here!\n⚠️ Warning *${count}/5* — ${5 - count} more warning(s) before removal.`,
              mentions: [sender],
            });
          }
          continue;
        }

        // Antilink
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
              text: `🚨 @${num} has been *removed* from the group for sending links repeatedly!`,
              mentions: [sender],
            });
            try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
            resetWarnings(from, num);
          } else {
            await sock.sendMessage(from, {
              text: `⛔ @${num}, links are *not allowed* here!\n⚠️ Warning *${count}/5* — ${5 - count} more warning(s) before removal.`,
              mentions: [sender],
            });
          }
          continue;
        }
      }

      if (!isCommand) continue;

      // ── Command dedup (one execution per msg ID across sessions) ──────────
      if (!msg.key.fromMe) {
        const dedupKey = `cmd:${msg.key.id}`;
        if (cmdDedup.get(dedupKey)) continue;
        cmdDedup.set(dedupKey, true);
      }

      const effectiveSender = msg.key.fromMe
        ? (sessionOwnerPhone + '@s.whatsapp.net')
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

      // ── Auto Typing (v2) ──────────────────────────────────────────────────
      // Fire-and-forget: sends composing presence, then yields 120ms so the
      // presence reaches WhatsApp servers before the reply arrives.
      // Does NOT block the event loop — never awaits the heavy simulation.
      if (state.autotyping && typeof autotypingCmd?.simulateTyping === 'function') {
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        await new Promise(r => setTimeout(r, 120)); // tiny yield only
      }

      // ── Command dispatch ───────────────────────────────────────────────────
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
        default: break;
      }
    } catch (e) {
      console.error('[Messages] Uncaught error in message loop:', e.message, e.stack?.split('\n')[1]);
    }
  }
}

// ── handleMessageDelete (messages.delete event) ────────────────────────────────
// Handles the legacy messages.delete Baileys event (still fired on some versions).
async function handleMessageDelete(sock, update, state, session) {
  if (!state?.antidelete) return;
  try {
    const sessionOwnerPhone = session?.phoneNumber || getAdminNumber();
    const dest = selfJid(sessionOwnerPhone);
    const keys = update?.keys || (Array.isArray(update) ? update : []);
    for (const key of keys) {
      await _restoreDeletedMessage(sock, key.id, dest);
    }
  } catch (e) { console.error('[AntiDelete/delete event]', e.message); }
}

// ── handleMessageEdit (messages.update event) ─────────────────────────────────
// FIXED: Also handles REVOKE (type 0) updates from modern Baileys.
// Modern WhatsApp primarily uses messages.update for both edits AND deletes.
async function handleMessageEdit(sock, updates, state, session) {
  if (!state) return;
  try {
    const sessionOwnerPhone = session?.phoneNumber || getAdminNumber();
    const dest = selfJid(sessionOwnerPhone);

    for (const { key, update } of (updates || [])) {
      try {
        const proto = update?.message?.protocolMessage;

        // REVOKE (type 0) — modern delete path via messages.update
        if (proto?.type === 0 && state.antidelete) {
          const deletedId = proto.key?.id || key.id;
          if (deletedId) {
            await _restoreDeletedMessage(sock, deletedId, dest);
          }
          continue;
        }

        // MESSAGE_EDIT (type 14) — edit path via messages.update
        if (proto?.type === 14 && state.antiedit) {
          const originalId = proto.key?.id || key.id;
          const newText    = extractEditedText(proto);
          if (originalId && newText) {
            const originalText = editCache.get(originalId);
            if (originalText && newText !== originalText) {
              const chatJid = proto.key?.remoteJid || key.remoteJid;
              const label   = chatJid && chatJid !== dest
                ? `\n📍 _From: ${chatJid}_\n` : '\n';
              await sock.sendMessage(dest, {
                text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
              });
            }
            editCache.set(originalId, newText);
          }
          continue;
        }

        // Fallback: edit encoded directly in update.message (some client versions)
        if (state.antiedit && !proto && update?.message) {
          const jid = key.remoteJid;
          if (!jid) continue;
          const original = editCache.get(key.id);
          if (!original) continue;

          const m      = update.message;
          const edited =
            m?.editedMessage?.message?.conversation                      ||
            m?.editedMessage?.message?.extendedTextMessage?.text         ||
            m?.editedMessage?.message?.imageMessage?.caption             ||
            m?.editedMessage?.message?.videoMessage?.caption             ||
            m?.protocolMessage?.editedMessage?.conversation              ||
            m?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
            m?.protocolMessage?.editedMessage?.imageMessage?.caption     ||
            m?.protocolMessage?.editedMessage?.videoMessage?.caption     ||
            m?.conversation                                              ||
            m?.extendedTextMessage?.text                                 ||
            '';

          if (!edited || edited === original) continue;

          const label = jid !== dest ? `\n📍 _From: ${jid}_\n` : '\n';
          await sock.sendMessage(dest, {
            text: `✏️ *Message Edited*${label}\n📌 *Original:*\n_"${original}"_\n\n🔄 *Edited to:*\n_"${edited}"_`,
          });
          editCache.set(key.id, edited);
        }
      } catch (innerErr) {
        console.error('[MessagesUpdate] Inner error:', innerErr.message);
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
          text: '📵 *Calls are not allowed!*\nThis bot cannot receive calls. Please send a message instead. 🙏',
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
