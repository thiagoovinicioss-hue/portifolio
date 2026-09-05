// Express application. Exported as a factory so tests can inject config.
//
// Security posture:
//  - Private endpoints require a Supabase Auth access token presented as an
//    `Authorization: Bearer …` header. The token is validated server-side on
//    EVERY request (constantly re-checked, never assumed).
//  - Authorization: only the single configured admin (ADMIN_USER_ID) is
//    allowed; any other verified user is denied.
//  - Fail closed: if the token can't be verified (expired/invalid) or Supabase
//    Auth is unreachable/misconfigured, access is denied (401 / 503) — never
//    allowed through.
//  - CORS only for the configured frontend origin(s), never "*". No cookies are
//    used, so CSRF is handled by the bearer-token model (browsers never attach
//    the token cross-site automatically).
//  - All sensitive responses are no-store.

import express from 'express';
import { loadConfig } from './lib/config.js';
import { createAuthValidator } from './lib/supauth.js';
import { createLeadsStore, VALID_STATUSES } from './lib/store.js';

// Whitelist of columns the public quote form may write. Anything else in the
// request body is dropped — clients can never set id, status, timestamps, etc.
const PUBLIC_LEAD_FIELDS = {
  name: { max: 120 },
  company_name: { max: 160 },
  company_type: { max: 100 },
  contact: { max: 160 },
  goals: { max: 100 },
  objective: { max: 100 },
  how_it_works_today: { max: 2000 },
  biggest_pain: { max: 2000 },
  weekly_time_spent: { max: 500 },
  previous_attempts: { max: 2000 },
  budget: { max: 80 },
  additional_info: { max: 2000 },
  selected_addons: { max: 8, array: true, itemMax: 80 },
};

function sanitizeLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const row = {};
  for (const [field, spec] of Object.entries(PUBLIC_LEAD_FIELDS)) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (spec.array) {
      if (!Array.isArray(value)) continue;
      row[field] = value
        .map((item) => String(item).slice(0, spec.itemMax))
        .filter((item) => item.length > 0)
        .slice(0, spec.max);
    } else {
      const text = String(value).slice(0, spec.max);
      if (text.length > 0) row[field] = text;
    }
  }
  if (!row.name) return null;
  return row;
}

export function createApp(overrides = {}) {
  const cfg = loadConfig(overrides);
  const auth = createAuthValidator(cfg);
  const store = createLeadsStore(cfg);

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);

  app.use(express.json({ limit: '16kb' }));
  app.use(securityHeaders());
  app.use(corsMiddleware(cfg));

  const requireAuth = makeRequireAdmin(auth, cfg, { enforceAAL: false });
  const requireAdmin = makeRequireAdmin(auth, cfg);

  // --- Public ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Public lead submission from the quote form. Intentionally anonymous: this is
  // the equivalent of a contact form. Fields are whitelisted and truncated
  // server-side; the insert runs with the SERVICE role key, so it never depends
  // on (possibly missing) RLS insert policies in the Supabase dashboard.
  app.post('/api/leads', async (req, res) => {
    const row = sanitizeLead(req.body);
    if (!row) return res.status(400).json({ error: 'bad_request' });
    try {
      await store.create(row);
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('leads.create failed', err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // --- MFA status (uses lighter auth — no AAL enforcement) ---
  app.get('/api/mfa/status', requireAuth, async (req, res) => {
    try {
      const mfaEnabled = await auth.hasMFA(req.user);
      const aal = req.aal || 'aal1';
      res.set('Cache-Control', 'no-store');
      res.json({ mfaEnabled, aal });
    } catch (err) {
      console.error('mfa.status failed', err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // --- Session check (restores the authenticated view after a refresh) ---
  app.get('/api/session', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      authenticated: true,
      user: { id: req.user.id, email: req.user.email || '' },
    });
  });

  // --- Private leads API (server-side authorization on every request) ---
  app.get('/api/leads', requireAdmin, async (req, res) => {
    try {
      const leads = await store.list();
      res.set('Cache-Control', 'no-store');
      res.json({ leads });
    } catch (err) {
      console.error('leads.list failed', err);
      res.status(500).json({ error: 'internal' });
    }
  });

  app.patch('/api/leads/:id', requireAdmin, async (req, res) => {
    const id = String(req.params.id ?? '');
    const status = String(req.body?.status ?? '');
    if (!id) return res.status(400).json({ error: 'bad_request' });
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'bad_request' });
    try {
      await store.update(id, { status });
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true });
    } catch (err) {
      console.error('leads.update failed', err);
      res.status(500).json({ error: 'internal' });
    }
  });

  app.delete('/api/leads/:id', requireAdmin, async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!id) return res.status(400).json({ error: 'bad_request' });
    try {
      await store.remove(id);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true });
    } catch (err) {
      console.error('leads.remove failed', err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // --- 404 for unknown API routes ---
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ error: 'bad_request' });
    }
    console.error('unhandled error', err);
    res.status(500).json({ error: 'internal' });
  });

  return { app, auth, store, cfg };
}

function makeRequireAdmin(auth, cfg, { enforceAAL = true } = {}) {
  return async function requireAdmin(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    let user;
    try {
      user = await auth.getUser(token);
    } catch (_) {
      // Auth layer unavailable/misconfigured -> fail closed.
      return res.status(503).json({ error: 'auth_unavailable' });
    }

    if (!user) return res.status(401).json({ error: 'unauthorized' });

    // The identity comes from the verified token; client-supplied ids are
    // never consulted. Only the configured admin is authorized.
    if (!cfg.adminUserId || user.id !== cfg.adminUserId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // Enforce MFA (AAL2) if the user has TOTP enabled.
    const aal = auth.getAAL(token);
    req.aal = aal;
    if (enforceAAL) {
      try {
        const mfaEnabled = await auth.hasMFA(user);
        if (mfaEnabled && aal !== 'aal2') {
          return res.status(403).json({ error: 'mfa_required' });
        }
      } catch (_) {
        return res.status(503).json({ error: 'auth_unavailable' });
      }
    }

    req.user = user;
    next();
  };

  function bearerToken(req) {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1].trim() : null;
  }
}

function securityHeaders() {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  return (req, res, next) => {
    res.set(headers);
    next();
  };
}

function corsMiddleware(cfg) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && cfg.frontendOrigins.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
      });
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  };
}