'use strict';
process.on('uncaughtException',  (err) => console.error('[BOTIFY X] Uncaught:', err?.message));
process.on('unhandledRejection', (r)   => console.error('[BOTIFY X] Rejection:', r instanceof Error ? r.message : String(r)));

if (typeof globalThis.crypto === 'undefined') globalThis.crypto = require('crypto').webcrypto;

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const cors    = require('cors');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

for (const [rel, val] of Object.entries({
  'data/settings.json': '{"botMode":"public","groups":{}}', 'data/warnings.json': '{}',
})) { const p = path.join(__dirname, rel); if (!fs.existsSync(p)) fs.writeFileSync(p, val); }

const runtimeRoutes = require('./routes/runtime');
const app = express();
app.use(cors());
app.use(express.json());

function requireApiKey(req, res, next) {
  const expected = process.env.CORE_API_KEY;
  if (!expected) return next();
  const key = req.headers['x-api-key'] || req.headers['x-core-api-key'];
  if (key !== expected) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.use('/runtime', requireApiKey, runtimeRoutes);
app.get('/healthz', (_, res) => res.json({ ok: true, ts: Date.now() }));

const PORT = Number(process.env.PORT || 3000);
const server = app.listen(PORT, '0.0.0.0', () => console.log('[BOTIFY X Core] Running on port ' + PORT));

// Auto-restore sessions after Railway restart
// Sessions boot as inactive=false; activateSession() is called when panel user clicks Start
const sessionManager = require('./utils/sessionManager');
const registry       = require('./utils/sessionRegistry');

registry.init().then(async () => {
  const validSessions = await registry.getAllValid();
  if (validSessions.length) {
    console.log('[BOTIFY X] Auto-restoring ' + validSessions.length + ' valid session(s)...');
    for (const id of validSessions) {
      // Check if this session was previously active (user had clicked Start)
      const wasActive = await registry.isActive(id).catch(() => false);
      sessionManager.startSession({ id, isOwner: false, active: wasActive })
        .catch(err => console.error('[BOTIFY X] Restore failed for ' + id + ':', err.message));
    }
  } else {
    console.log('[BOTIFY X] No sessions to restore.');
  }
}).catch(err => console.error('[BOTIFY X] Registry init failed:', err.message));

function shutdown(sig) {
  console.log('[BOTIFY X] ' + sig + ' — shutting down gracefully...');
  server.close(() => { console.log('[BOTIFY X] HTTP server closed.'); process.exit(0); });
  setTimeout(() => process.exit(1), 15000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
