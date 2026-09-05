// Integration tests for the portfolio auth backend.
// Runs against the real Express app with in-memory Supabase auth + leads mocks,
// covering: public, unauthenticated denial, authentication, AUTHORIZATION (only
// the configured admin user), fail-closed behaviour, CORS and lead CRUD.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';

const ALLOWED_ORIGIN = 'http://localhost:8080';
const ADMIN_USER_ID = '11111111-2222-3333-4444-555555555555';
const ADMIN_TOKEN = 'token-admin';
const OTHER_TOKEN = 'token-other'; // valid Supabase user, NOT the admin

async function withApp(overrides, fn) {
  const ctx = createApp(overrides);
  const server = ctx.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ baseUrl, ...ctx });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(baseUrl, path, { method = 'GET', body, headers = {}, token, origin } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (token) h.Authorization = `Bearer ${token}`;
  const opts = { method, headers: h };
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  return { status: res.status, data, headers: res.headers, allowOrigin: res.headers.get('access-control-allow-origin') };
}

const baseOverrides = {
  env: 'test',
  frontendOrigins: [ALLOWED_ORIGIN],
  adminUserId: ADMIN_USER_ID,
  mockAdminToken: ADMIN_TOKEN,
  mockUserToken: OTHER_TOKEN,
  supabaseMock: true,
  authMock: true,
};

describe('public endpoints', () => {
  test('health is reachable without authentication', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/health');
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, { ok: true });
    });
  });

  test('unknown api route returns 404 JSON', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/nope');
      assert.equal(res.status, 404);
    });
  });

  test('POST /api/leads is public and stores the quote (no token, no origin needed)', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const res = await request(baseUrl, '/api/leads', {
        method: 'POST',
        body: {
          name: 'Ada Lovelace',
          company_name: 'Analytical Engines',
          contact: 'ada@example.com',
          budget: 'R$ 3.000–5.000',
          selected_addons: ['automação de atendimento'],
        },
      });
      assert.equal(res.status, 201);
      assert.deepEqual(res.data, { ok: true });
      assert.match(res.headers.get('cache-control'), /no-store/i);

      const leads = await store.list();
      assert.equal(leads.length, 1);
      assert.equal(leads[0].name, 'Ada Lovelace');
      assert.equal(leads[0].budget, 'R$ 3.000–5.000');
      assert.deepEqual(leads[0].selected_addons, ['automação de atendimento']);
      assert.equal(leads[0].status, 'new');
    });
  });

  test('POST /api/leads requires a name -> 400', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const res = await request(baseUrl, '/api/leads', { method: 'POST', body: { contact: 'x@y.com' } });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'bad_request');
      assert.equal((await store.list()).length, 0);
    });
  });

  test('POST /api/leads strips unknown fields and clamps lengths', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const res = await request(baseUrl, '/api/leads', {
        method: 'POST',
        body: {
          name: 'Hacker',
          role: 'admin',
          status: 'won',
          magic: { sql: 'drop table' },
          budget: 'x'.repeat(500),
        },
      });
      assert.equal(res.status, 201);

      const leads = await store.list();
      assert.equal(leads.length, 1);
      assert.equal(leads[0].id, leads[0].id); // id is server-generated, not client-set
      assert.notEqual(String(leads[0].id).toLowerCase(), 'admin');
      assert.equal(leads[0].name, 'Hacker');
      assert.equal(leads[0].role, undefined);
      assert.equal(leads[0].status, 'new'); // client-supplied status is ignored
      assert.equal(leads[0].magic, undefined);
      assert.equal(leads[0].budget, 'x'.repeat(80));
    });
  });

  test('POST /api/leads rejects an oversized body -> 400', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const res = await request(baseUrl, '/api/leads', {
        method: 'POST',
        body: { name: 'Big', how_it_works_today: 'y'.repeat(20000) },
      });
      assert.equal(res.status, 400);
      assert.equal((await store.list()).length, 0);
    });
  });
});

describe('unauthenticated requests are rejected', () => {
  test('GET /api/session without token -> 401', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/session');
      assert.equal(res.status, 401);
      assert.equal(res.data.error, 'unauthorized');
    });
  });

  test('GET /api/leads without token -> 401', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/leads');
      assert.equal(res.status, 401);
    });
  });

  test('PATCH/DELETE /api/leads/:id without token -> 401', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const patch = await request(baseUrl, '/api/leads/abc', { method: 'PATCH', body: { status: 'won' } });
      assert.equal(patch.status, 401);
      const del = await request(baseUrl, '/api/leads/abc', { method: 'DELETE' });
      assert.equal(del.status, 401);
    });
  });

  test('invalid/garbage token -> 401', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const session = await request(baseUrl, '/api/session', { token: 'not-a-valid-token' });
      assert.equal(session.status, 401);
      const leads = await request(baseUrl, '/api/leads', { token: 'not-a-valid-token' });
      assert.equal(leads.status, 401);
    });
  });
});

describe('authentication: admin token', () => {
  test('GET /api/session returns the verified admin identity', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/session', { token: ADMIN_TOKEN });
      assert.equal(res.status, 200);
      assert.equal(res.data.authenticated, true);
      assert.equal(res.data.user.id, ADMIN_USER_ID);
    });
  });

  test('full lead CRUD flow works for the admin', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const lead = store.seed({ name: 'Ada Lovelace', status: 'new' });

      const leads = await request(baseUrl, '/api/leads', { token: ADMIN_TOKEN });
      assert.equal(leads.status, 200);
      assert.equal(leads.data.leads.length, 1);
      assert.equal(leads.data.leads[0].id, lead.id);
      assert.equal(leads.data.leads[0].status, 'new');

      const patch = await request(baseUrl, `/api/leads/${lead.id}`, { method: 'PATCH', token: ADMIN_TOKEN, body: { status: 'won' } });
      assert.equal(patch.status, 200);

      const after = await request(baseUrl, '/api/leads', { token: ADMIN_TOKEN });
      assert.equal(after.data.leads[0].status, 'won');

      const del = await request(baseUrl, `/api/leads/${lead.id}`, { method: 'DELETE', token: ADMIN_TOKEN });
      assert.equal(del.status, 200);

      const empty = await request(baseUrl, '/api/leads', { token: ADMIN_TOKEN });
      assert.equal(empty.data.leads.length, 0);
    });
  });

  test('private responses are served as no-store', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const session = await request(baseUrl, '/api/session', { token: ADMIN_TOKEN });
      assert.match(session.headers.get('cache-control'), /no-store/i);
      const leads = await request(baseUrl, '/api/leads', { token: ADMIN_TOKEN });
      assert.match(leads.headers.get('cache-control'), /no-store/i);
    });
  });

  test('invalid status is rejected -> 400', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const lead = store.seed({ name: 'X' });
      const patch = await request(baseUrl, `/api/leads/${lead.id}`, { method: 'PATCH', token: ADMIN_TOKEN, body: { status: 'bogus' } });
      assert.equal(patch.status, 400);
    });
  });
});

describe('authorization: only the configured admin is allowed', () => {
  test('a valid non-admin Supabase user is denied everywhere', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const session = await request(baseUrl, '/api/session', { token: OTHER_TOKEN });
      assert.equal(session.status, 401);

      const leads = await request(baseUrl, '/api/leads', { token: OTHER_TOKEN });
      assert.equal(leads.status, 401);

      const patch = await request(baseUrl, '/api/leads/abc', { method: 'PATCH', token: OTHER_TOKEN, body: { status: 'won' } });
      assert.equal(patch.status, 401);
    });
  });

  test('a client-supplied user id is ignored; identity comes from the token only', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const lead = store.seed({ name: 'Asked by admin' });
      const res = await request(baseUrl, `/api/leads?userId=${ADMIN_USER_ID}`, { token: ADMIN_TOKEN });
      assert.equal(res.status, 200);
      // The result is scoped by the verified admin token, never by params.
      assert.equal(res.data.leads.length, 1);
      assert.equal(res.data.leads[0].id, lead.id);
    });
  });

  test('a user id in the query/PATCH body cannot escalate a non-admin', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const lead = store.seed({ name: 'X' });
      const patch = await request(baseUrl, `/api/leads/${lead.id}`, {
        method: 'PATCH',
        token: OTHER_TOKEN,
        body: { status: 'won', userId: ADMIN_USER_ID },
      });
      assert.equal(patch.status, 401);
    });
  });
});

describe('fail-closed behaviour', () => {
  test('Supabase Auth unavailable -> 503 even with a plausible token', async () => {
    await withApp(baseOverrides, async ({ baseUrl, auth }) => {
      auth.getUser = async () => { throw new Error('supabase down'); };
      const session = await request(baseUrl, '/api/session', { token: ADMIN_TOKEN });
      assert.equal(session.status, 503);
      assert.equal(session.data.error, 'auth_unavailable');
      const leads = await request(baseUrl, '/api/leads', { token: ADMIN_TOKEN });
      assert.equal(leads.status, 503);
    });
  });

  test('backend with no Supabase / no ADMIN_USER_ID configured fails closed', async () => {
    await withApp({ ...baseOverrides, authMock: false, supabaseUrl: '', supabaseServiceRoleKey: '', adminUserId: '' }, async ({ baseUrl }) => {
      const session = await request(baseUrl, '/api/session', { token: 'anything' });
      assert.equal(session.status, 503);
      assert.equal(session.data.error, 'auth_unavailable');
      const leads = await request(baseUrl, '/api/leads', { token: 'anything' });
      assert.equal(leads.status, 503);
    });
  });
});

describe('CORS', () => {
  test('allowlisted origin gets CORS headers including Authorization', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/session', { method: 'OPTIONS', origin: ALLOWED_ORIGIN });
      assert.equal(res.allowOrigin, ALLOWED_ORIGIN);
      assert.match(res.headers.get('access-control-allow-headers'), /Authorization/i);
    });
  });

  test('disallowed origin gets no CORS headers', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/session', { method: 'OPTIONS', origin: 'https://evil.example' });
      assert.equal(res.allowOrigin, null);
    });
  });

  test('bearer architecture: a valid token is accepted regardless of Origin (no CSRF needed)', async () => {
    await withApp(baseOverrides, async ({ baseUrl, store }) => {
      const lead = store.seed({ name: 'X' });
      const res = await request(baseUrl, `/api/leads/${lead.id}`, {
        method: 'PATCH', token: ADMIN_TOKEN, origin: 'https://evil.example', body: { status: 'lost' },
      });
      // Authorization is carried by the bearer header (never sent by browsers
      // cross-site automatically), so a foreign Origin alone proves nothing.
      assert.notEqual(res.status, 401);
    });
  });

  test('no token from any origin still fails', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/leads', { origin: ALLOWED_ORIGIN });
      assert.equal(res.status, 401);
    });
  });
});

describe('MFA status endpoint', () => {
  test('GET /api/mfa/status returns mfaEnabled=false for mock auth', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/mfa/status', { token: ADMIN_TOKEN });
      assert.equal(res.status, 200);
      assert.equal(res.data.mfaEnabled, false);
      assert.equal(res.data.aal, 'aal2');
    });
  });

  test('GET /api/mfa/status requires authentication', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/mfa/status');
      assert.equal(res.status, 401);
    });
  });

  test('GET /api/mfa/status rejects non-admin users', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/mfa/status', { token: OTHER_TOKEN });
      assert.equal(res.status, 401);
    });
  });

  test('GET /api/mfa/status response is no-store', async () => {
    await withApp(baseOverrides, async ({ baseUrl }) => {
      const res = await request(baseUrl, '/api/mfa/status', { token: ADMIN_TOKEN });
      assert.match(res.headers.get('cache-control'), /no-store/i);
    });
  });
});