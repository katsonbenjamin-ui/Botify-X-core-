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

// BUG FIX (#13): msgcounts.json was never initialized — addMsgCount() writes to
// it fine, but on a fresh Railway deployment the file didn't exist and topchat
// would return empty until at least one message was processed and the file was
// written for the first time. Initializing here ensures the file always exists.
for (const [rel, val] of Object.entries({
  'data/settings.json':  '{"botMode":"public","groups":{}}',
  'data/warnings.json':  '{}',
  'data/msgcounts.json': '{}',
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

const PORT   = Number(process.env.PORT || 3000);
const server = app.listen(PORT, '0.0.0.0', () =>
  console.log('[BOTIFY X Core] Running on port ' + PORT),
);

// ── Session restore with Postgres hydration ────────────────────────────────────
const sessionManager = require('./utils/sessionManager');
const registry       = require('./utils/sessionRegistry');
const { hydrateFromPg } = require('./utils/dataManager');

registry.init().then(async () => {
  // ① Restore settings/state from Postgres to local JSON BEFORE starting sessions.
  //    Without this step, Railway's ephemeral filesystem loses all anti-feature
  //    settings on every restart and sessions come up with everything disabled.
  if (process.env.DATABASE_URL) {
    try {
      await hydrateFromPg();
    } catch (e) {
      console.error('[BOTIFY X] Hydration from Postgres failed (non-fatal):', e.message);
    }
  }

  // ② Restore WhatsApp sessions from the registry.
  const validSessions = await registry.getAllValid();
  if (validSessions.length) {
    console.log('[BOTIFY X] Auto-restoring ' + validSessions.length + ' valid session(s)...');
    for (const id of validSessions) {
      const wasActive = await registry.isActive(id).catch(() => false);
      sessionManager
        .startSession({ id, isOwner: false, active: wasActive })
        .catch(err => console.error('[BOTIFY X] Restore failed for ' + id + ':', err.message));
    }
  } else {
    console.log('[BOTIFY X] No sessions to restore.');
  }
}).catch(err => console.error('[BOTIFY X] Registry init failed:', err.message));

function shutdown(sig) {
  console.log('[BOTIFY X] ' + sig + ' — shutting down gracefully...');
  server.close(() => { console.log('[BOTIFY X] HTTP server closed.'); process.exit(0); });
  setTimeout(() => process.exit(1), 15_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
