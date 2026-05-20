'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const fs = require('fs');
const path = require('path');

const { setConnected, setSocket } = require('./utils/botState');

const AUTH_DIR = path.join(__dirname, 'auth');

let sock;
let starting = false;

async function startBot(phoneNumber) {
  if (starting) return null;
  starting = true;

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      printQRInTerminal: false,
      browser: ['Mac OS', 'Safari', '10.15.7'],
    });

    setSocket(sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log('✅ Connected!');
        setConnected(true);
        starting = false;
      }

      if (connection === 'close') {
        setConnected(false);

        const code = lastDisconnect?.error?.output?.statusCode;
        console.log('❌ Connection closed:', code);

        // reconnect except logout
        if (code !== DisconnectReason.loggedOut) {
          console.log('🔄 Reconnecting...');
          startBot(phoneNumber);
        } else {
          console.log('⚠️ Logged out. Delete auth folder.');
        }

        starting = false;
      }
    });

    // 🔥 IMPORTANT FIX: delay pairing properly
    if (!state.creds.registered && phoneNumber) {
      console.log('⏳ Waiting before pairing...');
      await new Promise(r => setTimeout(r, 5000));

      const clean = phoneNumber.replace(/\D/g, '');

      const code = await sock.requestPairingCode(clean);

      console.log('🔥 Pairing code:', code);

      starting = false;
      return code;
    }

    starting = false;
    return null;

  } catch (err) {
    console.error('❌ BOT ERROR:', err);
    starting = false;
    return null;
  }
}

module.exports = { startBot };
