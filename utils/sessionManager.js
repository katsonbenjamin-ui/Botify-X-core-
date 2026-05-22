'use strict';

const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const NodeCache = require('node-cache');

const config       = require('./config');
const logger       = require('./logger');
const users        = require('./users');
const botState     = require('./botState');
const { loadSessionState, saveSessionState } = require('./dataManager');
const {
  handleMessages,
  handleMessageDelete,
  handleMessageEdit,
  handleCall,
} = require('../events/messages');
const { handleGroupParticipants } = require('../events/groupParticipants');
const handleConnection             = require('../events/connection');
const { usePgAuthState }           = require('./pgAuthState');
const registry                     = require('./sessionRegistry');

const sessions        = new Map();
const pendingPairings = new Map();
const qrCodes         = new Map();
const reconnectDelays = new Map();
const sessionLogs     = new Map();

function getSession(id)  { return sessions.get(id) || null; }

function appendLog(id, message) {
  if (!sessionLogs.has(id)) sessionLogs.set(id, []);
  const arr = sessionLogs.get(id);
  arr.push({ ts: Date.now(), message: String(message) });
  if (arr.length > 100) arr.shift();
}

function getSessionLogs(id) { return sessionLogs.get(id) || []; }

function listSessions() {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    id, connected: !!s.sock?.user, user: s.sock?.user || null,
    isOwner: !!s.isOwner, active: !!s.active,
  }));
}

async function fetchVersion() {
  try {
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('version fetch timeout')), 8000)),
    ]);
    return result.version;
  } catch { return [2, 3000, 1023141840]; }
}

function _scheduleReconnect({ id, phoneNumber, isOwner, active }, delayOverride) {
  const prev      = reconnectDelays.get(id) || 0;
  const nextDelay = delayOverride !== undefined ? delayOverride
    : (prev === 0 ? 4_000 : Math.min(prev * 2, 120_000));
  reconnectDelays.set(id, nextDelay);
  logger.warn({ id, nextDelay }, 'Scheduling reconnect');
  const attempt = () => {
    startSession({ id, phoneNumber, isOwner, active })
      .then(() => {}).catch((err) => {
        logger.error({ err, id }, 'Reconnect failed');
        const d = Math.min((reconnectDelays.get(id) || 4_000) * 2, 120_000);
        reconnectDelays.set(id, d);
        setTimeout(attempt, d);
      });
  };
  setTimeout(attempt, nextDelay);
}

/**
 * active defaults to false — bot connects to WhatsApp but ignores commands
 * until the Client Panel user clicks Start, which calls activateSession().
 */
async function startSession({ id, phoneNumber = null, isOwner = false, active = false } = {}) {
  if (!id) throw new Error('Session id is required');
  if (sessions.has(id)) return sessions.get(id);

  // Auth state from Postgres — survives Railway restarts
  const { state, saveCreds } = await usePgAuthState(id);

  const version              = await fetchVersion();
  const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser:                        Browsers.ubuntu('Chrome'),
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    generateHighQualityLinkPreview: false,
    shouldSyncHistoryMessage:       () => false,
    connectTimeoutMs:               60_000,
    keepAliveIntervalMs:            20_000,
    retryRequestDelayMs:            3_000,
    getMessage: async () => ({ conversation: '' }),
    msgRetryCounterCache,
    maxMsgRetryCount: 3,
    fireInitQueries:  true,
  });

  // active=false: bot is connected to WhatsApp but ignores all commands
  // active=true:  bot responds to commands (user clicked Start on Client Panel)
  const session = {
    id, sock, isOwner, phoneNumber, saveCreds,
    onlineTimer: null, connectedAt: 0, shuttingDown: false,
    active,
    pairingCode: null,
  };
  sessions.set(id, session);

  const stateKey = phoneNumber || id;
  const rawState = {
    anticall: false, antidelete: false, antiedit: false, alwaysonline: false,
    ...loadSessionState(stateKey),
  };

  const sessionState = new Proxy(rawState, {
    set(target, prop, value) {
      target[prop] = value;
      saveSessionState(stateKey, target);
      if (prop === 'alwaysonline') {
        if (value && !session.onlineTimer) {
          session.onlineTimer = setInterval(() => { sock.sendPresenceUpdate('available').catch(() => {}); }, 15_000);
        } else if (!value && session.onlineTimer) {
          clearInterval(session.onlineTimer); session.onlineTimer = null;
        }
      }
      return true;
    },
  });
  session.state = sessionState;

  if (rawState.alwaysonline && !session.onlineTimer) {
    session.onlineTimer = setInterval(() => { sock.sendPresenceUpdate('available').catch(() => {}); }, 15_000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) { qrCodes.set(id, { qr, updatedAt: Date.now() }); }

    if (session.shuttingDown) {
      if (connection === 'close') { sessions.delete(id); qrCodes.delete(id); }
      return;
    }

    if (connection === 'open') {
      appendLog(id, 'Connected to WhatsApp.' + (session.active ? '' : ' (inactive — awaiting Start)'));
      pendingPairings.delete(id); qrCodes.delete(id);
      session.connectedAt = Date.now();
      reconnectDelays.delete(id);
      if (isOwner) {
        const num = sock.user?.id?.split(':')[0]?.split('@')[0]?.replace(/\D/g, '');
        if (num) { try { config.owner.set(num); } catch {} session.phoneNumber = num; }
      }
      if (!isOwner && phoneNumber) users.markPaired(phoneNumber, true);
      botState.setConnected(true);
      // Only send the "connected" WhatsApp greeting when the session is active
      if (session.active) {
        try { await handleConnection.onOpen({ session }); } catch (err) { logger.error({ err }, 'connection.onOpen failed'); }
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || 0;
      const loggedOut  = statusCode === DisconnectReason.loggedOut;
      const replaced   = statusCode === 428;
      const restartNeeded = statusCode === DisconnectReason.restartRequired || statusCode === 515;

      appendLog(id, 'Connection closed: ' + statusCode);
      sessions.delete(id);

      if (loggedOut || replaced) { appendLog(id, loggedOut ? 'Logged out.' : 'Session replaced.'); return; }
      if (!session.shuttingDown) {
        _scheduleReconnect(
          { id, phoneNumber, isOwner, active: session.active },
          restartNeeded ? 2_000 : undefined
        );
      }
    }
  });

  sock.ev.on('messages.upsert', async (payload) => {
    // Inactive: bot is connected but ignores all messages/commands silently
    if (!session.active) return;
    if (payload.type !== 'notify') return;
    try { await handleMessages({ sock, session, payload }); }
    catch (err) { logger.error({ err }, 'msg handler error'); }
  });

  sock.ev.on('messages.delete', (item) => {
    if (!session.active) return;
    try { handleMessageDelete(sock, item, session.state, session); } catch {}
  });

  sock.ev.on('messages.update', (updates) => {
    if (!session.active) return;
    try { handleMessageEdit(sock, updates, session.state, session); } catch {}
  });

  sock.ev.on('call', async (calls) => {
    if (!session.active) return;
    try { await handleCall(sock, calls, session.state); } catch {}
  });

  sock.ev.on('group-participants.update', async (update) => {
    if (!session.active) return;
    try { await handleGroupParticipants({ sock, update, sessionState }); } catch {}
  });

  return session;
}

/**
 * Activate a session: bot starts responding to commands.
 * Called by /runtime/:id/start route.
 */
async function activateSession(id) {
  const session = sessions.get(id);
  if (session) {
    session.active = true;
    appendLog(id, 'Session activated — bot now responding to commands.');
    try { await handleConnection.onOpen({ session }); } catch {}
  }
  await registry.activate(id);
}

async function stopSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  session.shuttingDown = true;
  try { session.sock?.end(undefined); } catch {}
  if (session.onlineTimer) { clearInterval(session.onlineTimer); session.onlineTimer = null; }
  sessions.delete(id);
  appendLog(id, 'Session stopped.');
  await registry.deactivate(id);
}

function restoreExistingSessions() { return []; }

function ownerSession() { return sessions.get('owner') || null; }

module.exports = {
  startSession,
  activateSession,
  stopSession,
  getSession,
  listSessions,
  getSessionLogs,
  restoreExistingSessions,
  ownerSession,
};
