'use strict';

/**
 * events/messages.js — BOTIFY X Core Message Pipeline Engine
 */

const fs = require('fs');
const path = require('path');
const NodeCache = require('node-cache');

// Centralized Context Parser Core
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

// Explicitly Required Command Mapping Matrix
const commands = {
  antilink: require('../commands/antilink'),
  anticall: require('../commands/anticall'),
  antidelete: require('../commands/antidelete'),
  antiedit: require('../commands/antiedit'),
  antigroupmention: require('../commands/antigroupmention'),
  approve: require('../commands/approve'),
  approveall: require('../commands/approveall'),
  disapproveall: require('../commands/disapproveall'),
  close: require('../commands/close'),
  closetime: require('../commands/closetime'),
  open: require('../commands/open'),
  opentime: require('../commands/opentime'),
  listactive: require('../commands/listactive'),
  togstatus: require('../commands/togstatus'),
  block: require('../commands/block'),
  unblock: require('../commands/unblock'),
  listblocked: require('../commands/listblocked'),
  delete: require('../commands/delete'),
  alwaysonline: require('../commands/alwaysonline'),
  helpers: require('../commands/helpers'),
  promote: require('../commands/promote'),
  demote: require('../commands/demote'),
  kick: require('../commands/kick'),
  resetlink: require('../commands/resetlink'),
  welcome: require('../commands/welcome'),
  goodbye: require('../commands/goodbye'),
  tagall: require('../commands/tagall'),
  hidetag: require('../commands/hidetag'),
  warn: require('../commands/warn'),
  resetwarn: require('../commands/resetwarn'),
  resetcount: require('../commands/resetcount'),
  vv: require('../commands/vv'),
  getpp: require('../commands/getpp'),
  ping: require('../commands/ping'),
  mode: require('../commands/mode'),
  sticker: require('../commands/sticker'),
  menu: require('../commands/menu'),
  botstatus: require('../commands/botstatus'),
  statusSaver: require('../commands/statusSaver'),
  ai: require('../commands/ai'),
  summary: require('../commands/summary'),
  autoreact: require('../commands/autoreact'),
  statusreply: require('../commands/statusreply'),
  ship: require('../commands/ship'),
  topchat: require('../commands/topchat'),
  toimg: require('../commands/toimg'),
  tomp3: require('../commands/tomp3'),
  tts: require('../commands/tts'),
  runtime: require('../commands/runtime'),
  backup: require('../commands/backup'),
  autotyping: require('../commands/autotyping')
};

// RAM Cache Layer with Local Disk Fallback Configuration
const msgCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });
const cmdDedup = new NodeCache({ stdTTL: 15, checkperiod: 5 });
const DISK_CACHE_PATH = path.join(__dirname, '../.msg_cache_store.json');

function saveCacheToDisk() {
  try {
    const keys = msgCache.keys();
    const dataToSave = {};
    keys.forEach(k => {
      const val = msgCache.get(k);
      if (val) dataToSave[k] = val;
    });
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(dataToSave), 'utf-8');
  } catch (e) {
    console.error('⚠️ Disk Cache Persistence Failure:', e.message);
  }
}

function loadCacheFromDisk() {
  try {
    if (fs.existsSync(DISK_CACHE_PATH)) {
      const raw = fs.readFileSync(DISK_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      Object.keys(parsed).forEach(k => {
        msgCache.set(k, parsed[k]);
      });
      console.log('📦 Re-bound structural cache keys cleanly following context restart.');
    }
  } catch (e) {
    console.error('⚠️ Local cache binding sequence bypassed:', e.message);
  }
}

// Automatically load on file initialization
loadCacheFromDisk();

function messageLabel(msg) {
  const body = extractText(msg);
  if (body) return body;
  const m = msg.message;
  if (!m) return '';
  if (m.imageMessage) return '[Image]';
  if (m.videoMessage) return '[Video]';
  if (m.audioMessage) return '[Audio]';
  if (m.documentMessage) return `[Document: ${m.documentMessage.fileName || 'file'}]`;
  if (m.stickerMessage) return '[Sticker]';
  if (m.viewOnceMessage || m.viewOnceMessageV2) return '[View Once]';
  return '[Media Component]';
}

function isGroupMentionMsg(msg) {
  if (!msg?.message) return false;
  const ctx = resolveContext(msg);
  if (msg.message.groupMentionedMessage || ctx?.groupMentionedMessage) return true;
  if (ctx?.mentionedJid && Array.isArray(ctx.mentionedJid)) {
    return ctx.mentionedJid.some(jid => jid.endsWith('@g.us'));
  }
  return false;
}

module.exports = function registerMessagePipeline(sock) {
  
  // ── EVENT LISTEN: INCOMING MESSAGES (UPSERT) ───────────────────
  sock.ev.on('messages.upsert', async (upsert) => {
    if (upsert.type !== 'notify' || !upsert.messages) return;

    for (const rawMsg of upsert.messages) {
      try {
        if (!rawMsg.message) continue;
        const msgId = rawMsg.key.id;
        const fromJid = rawMsg.key.remoteJid;
        const isSelf = rawMsg.key.fromMe;

        const structuredMessageRecord = {
          from: fromJid,
          body: extractText(rawMsg),
          label: messageLabel(rawMsg),
          timestamp: rawMsg.messageTimestamp,
          fullMsg: JSON.parse(JSON.stringify(rawMsg))
        };
        
        msgCache.set(msgId, structuredMessageRecord);
        saveCacheToDisk();

        // 1. Antigroupmention Filtering Logic
        if (fromJid.endsWith('@g.us') && isGroupMentionMsg(rawMsg) && !isSelf) {
          const settings = getGroupSettings(fromJid);
          if (settings?.antigroupmention) {
            await sock.sendMessage(fromJid, { delete: rawMsg.key });
            await commands.antigroupmention.execute(sock, rawMsg, { action: 'warn' });
            continue; 
          }
        }

        // 2. Antilink Interception Routing
        if (fromJid.endsWith('@g.us') && !isSelf) {
          const textContent = extractText(rawMsg);
          const settings = getGroupSettings(fromJid);
          if (settings?.antilink && /(https?:\/\/\S+|chat\.whatsapp\.com\/\S+)/i.test(textContent)) {
            await sock.sendMessage(fromJid, { delete: rawMsg.key });
            await commands.antilink.execute(sock, rawMsg, { action: 'warn' });
            continue;
          }
        }

        // 3. Status Pipeline Filtering Layer
        if (fromJid === 'status@broadcast') {
          await commands.statusreply.execute(sock, rawMsg);
          await commands.statusSaver.execute(sock, rawMsg, { mode: 'auto' });
          continue;
        }

        // 4. Autotyping Presence Generator
        if (fromJid && !isSelf && !fromJid.endsWith('@g.us')) {
          await commands.autotyping.execute(sock, fromJid);
        }

        // 5. Command Parsing Gateway Implementation
        const textMessage = extractText(rawMsg) || '';
        const prefixPattern = /^[!.*#/\\]/; 
        if (prefixPattern.test(textMessage)) {
          const args = textMessage.trim().split(/ +/);
          const cmdName = args.shift().toLowerCase().replace(prefixPattern, '');
          
          if (commands[cmdName]) {
            if (cmdDedup.has(msgId)) continue;
            cmdDedup.set(msgId, true);
            await commands[cmdName].execute(sock, rawMsg, args);
          }
        }

      } catch (pipelineError) {
        console.error(`❌ Non-blocking pipeline failure [UPSERT]:`, pipelineError);
      }
    }
  });

  // ── EVENT LISTEN: MESSAGES UPDATE (DELETES, EDITS, REACTIONS) ──
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      try {
        const msgId = update.key.id;
        const targetChat = update.key.remoteJid;
        const cachedReference = msgCache.get(msgId);

        // A. Process Deletions (antidelete)
        if (update.update?.protocolMessage?.type === 0 || update.update?.messageStubType === 68) {
          if (cachedReference) {
            await commands.antidelete.execute(sock, cachedReference, update);
          }
          continue;
        }

        // B. Process Edits (antiedit)
        if (update.update?.editedMessage || update.update?.protocolMessage?.type === 14) {
          if (cachedReference) {
            await commands.antiedit.execute(sock, cachedReference, update);
          }
          continue;
        }

        // C. Process Reaction Message Protocols
        if (update.update?.reactionMessage) {
          const reactionPayload = update.update.reactionMessage;
          const targetEmoji = reactionPayload.text;
          
          if (cachedReference && targetEmoji) {
            // Secret Feature #4: View Once Revealer (Solo emoji reply)
            if (isViewOnce(cachedReference.fullMsg)) {
              await commands.vv.execute(sock, cachedReference.fullMsg);
            }

            // Secret Feature #5: Direct Status Saver Trigger
            if (targetChat === 'status@broadcast') {
              await commands.statusSaver.execute(sock, cachedReference.fullMsg, { mode: 'force' });
            }
          }
        }

      } catch (updateError) {
        console.error(`❌ Non-blocking pipeline failure [UPDATE]:`, updateError);
      }
    }
  });
};
