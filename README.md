# Thiago Vinícius — Portfólio Website

Static, trilingual (PT / EN / ES) personal portfolio. Landing page with a 3D
project carousel, a multi-step quote (orçamento) flow that hands off to WhatsApp
and a **private leads dashboard** whose authentication & authorization layer is
**Supabase Auth**.

The portfolio itself remains a **plain static site** (HTML + CSS + ES modules)
hosted on GitHub Pages.

## Architecture

```
                    PUBLIC
                       │
                       ▼
               GitHub Pages
                       │
          ┌────────────┴────────────┐
          │                         │
       Public site              /#/admin
                                     │
                                     ▼
                             Supabase Auth   (email/password)
                                     │
                             access token
                                     │
                                     ▼
                             Node/Express
                                     │
                       verify token server-side
                       check ADMIN_USER_ID
                                     │
                                     ▼
                             Supabase DB  (service-role key, server-only)
                                     │
                                     ▼
                                   Leads
```

## How the private area is secured

- **Real server-side authentication.** The visitor signs in with
  email/password against **Supabase Auth**. The resulting access token is sent
  to the backend as `Authorization: Bearer …`.
- **Verified on every request.** The backend re-validates the token with
  Supabase on each private call — the identity comes from the verified token,
  never from anything the client sends. No `isAuthenticated` flag is ever
  trusted; the persisted Supabase session is only a UX convenience.
- **Single-admin authorization.** The backend lets exactly one account through:
  the one whose UUID is set in `ADMIN_USER_ID`. Any other (valid) Supabase user
  is denied.
- **Fail closed.** If the token is invalid/expired, or Supabase can't be reached
  or is unconfigured, private access is denied (401 / 503) — never granted.
- **Service-role key stays server-side.** Private lead reads/updates/deletes go
  through the backend using the service-role key. That key must never be placed
  in `js/config.js` or shipped to the browser.
- **CORS** is restricted to the exact frontend origin (never `*`). No cookies
  are used, so CSRF is handled by the bearer-token model: browsers never attach
  the token automatically.
- **Row Level Security** keeps the public (anon) key from reading leads: the
  quote form can INSERT, but SELECT/UPDATE/DELETE are scoped to your admin user
  (see `supabase/schema.sql`).

## Project structure

```
index.html            SPA shell (home / quote / admin views + header/footer)
css/                  main, carousel, quote, admin styles
js/                   ES modules: config, i18n, projects, carousel, quote, backend, ui, admin, main
assets/               profile.webp, og.webp, apple-touch-icon.png, previews/*.webp
supabase/schema.sql   database setup for the leads table + RLS
server/               Portfolio backend (Node/Express): Supabase Auth gateway + private leads API
favicon.svg, robots.txt, sitemap.xml
```

## Setup — Supabase (one time, in the dashboard)

1. Open your Supabase project → **SQL Editor**, run `supabase/schema.sql`.
   Replace `REPLACE_WITH_ADMIN_USER_ID` with your admin UUID (step 2) before or
   after running — read access stays closed until then (fail closed).
2. **Authentication → Users → Add user**. Create your admin e-mail + password.
3. In **Authentication → Users**, copy the **UUID** of that admin user.
   This becomes `ADMIN_USER_ID` in the backend.

## Setup — backend (`server/`)

The backend is a small Node (≥ 18) Express service. Deploy it to any hosting
that runs a long-lived process (Render, Railway, Fly.io, a VPS, …).

1. `cd server && npm install`
2. `cp .env.example .env` and fill:
   - `SUPABASE_URL` — your project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key (Settings → API).
     Server-side only.
   - `ADMIN_USER_ID` — your admin UUID from step 3 above.
   - `FRONTEND_ORIGINS` — the exact GitHub Pages origin, e.g.
     `https://thiagoovinicioss-hue.github.io` (+ `http://localhost:8080` locally).
3. Run with `npm start`.

No reintroduction of cookies/WP connectors: `ADMIN_USER_ID`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `FRONTEND_ORIGINS` are the only sensitive values
and all live in environment variables.

## Setup — frontend (`js/config.js`)

Public values only:

```js
supabase: { url: 'https://…supabase.co', anonKey: 'sb_publishable_…' },
auth: { apiBaseUrl: 'https://portfolio-api.example.com' },
```

The anon/publishable key and the API URL are public by design. Leave
`apiBaseUrl` empty to run the site with the private area disabled.

## Public configuration (`js/config.js`)

| Setting | What to do |
|---|---|
| `whatsapp.number` | Your real WhatsApp number (digits only). |
| `social.*` | LinkedIn / Instagram / GitHub links. |
| `profileImage` | Path to `assets/profile.webp`. |
| `supabase.url` / `supabase.anonKey` | Enables lead storage & the quote flow saving to Supabase. |

The quote flow is unchanged: visitors fill the multi-step form, the public code
INSERTs the lead with the anon key under RLS, and hands off to WhatsApp.

## REST API (private, backend)

| Method | Endpoint | Auth |
|---|---|---|
| `GET` | `/api/session` | `Bearer <Supabase access token>` (must be the admin) |
| `GET` | `/api/leads` | `Bearer <Supabase access token>` |
| `PATCH` | `/api/leads/:id` | `Bearer <Supabase access token>`, body `{ "status": "won" }` |
| `DELETE` | `/api/leads/:id` | `Bearer <Supabase access token>` |

All private endpoints verify the token with Supabase on every request and reject
non-admin users. Supabase being down/unconfigured → `503 auth_unavailable`
(fail closed).

## Run locally (frontend only)

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Run locally (full stack + mocks)

Dev-only mocks are included so the whole flow can be exercised without a live
Supabase project:

```bash
cd server
npm run dev     # backend on :8787 with:
# .env: SUPABASE_MOCK=1 SUPABASE_AUTH_MOCK=1 ADMIN_USER_ID=<any>, and
# AUTH_MOCK_ADMIN_TOKEN=dev-admin-token (the "admin" token)
# frontend js/config.js: auth.apiBaseUrl = 'http://localhost:8787'

# Signed-in state is simulated by sending the admin token from the browser —
# with SUPABASE_AUTH_MOCK the real Supabase client won't have a session, so in
# the mock dev setup you test the API directly rather than via the login form.
```

Mocks are gated by env vars and must never be enabled in production.

## Tests

```bash
cd server && npm test
```

Covers: public endpoints, unauthenticated denial (no token / bogus token),
admin CRUD, **non-admin users denied**, client-supplied user ids ignored,
fail-closed when Supabase is down/unconfigured, CORS allowlist, no-store headers.

## Supabase Auth — what you configure in the dashboard

No code changes required for these:

1. Open your Supabase project → **Authentication** → **Users** → **Add user**.
2. Create the admin user (e-mail + password) — this is your login for `/#/admin`.
3. Copy that user's **UUID**.
4. Put it in the backend env as `ADMIN_USER_ID`, and (after creating your
   account) replace `REPLACE_WITH_ADMIN_USER_ID` in `supabase/schema.sql`.

## Deploy to GitHub Pages

Push to `main` with Pages enabled (Settings → Pages → source `main`, root).

- Site: `https://thiagoovinicioss-hue.github.io/portifolio/`
- Quote: `/portifolio/#/orcamento`
- Admin: `/portifolio/#/admin`

Set `CONFIG.auth.apiBaseUrl` to the deployed backend URL and use the GitHub Pages
origin in `FRONTEND_ORIGINS`.

## Troubleshooting — "área restrita não mostra os leads"

If a client's quote **opens WhatsApp but the lead never appears** in the admin
dashboard, the cause is usually that the **public insert policy is missing** on
the live Supabase database (Supabase rejects the insert with
`42501 ... violates row-level security`), and the client is silently redirected
to WhatsApp without anything being stored.

Most of this is now handled automatically:

- Since the backend-first change, the quote form saves leads via
  `POST /api/leads` → the backend inserts them with the **service role key**
  server-side, which bypasses RLS entirely. No dashboard action is required.
- If a save still fails, the site now shows a visible warning on the success
  screen instead of silently dropping the lead.

Still useful to apply once (dashboard → **SQL Editor** → run `supabase/policies.sql`,
idempotent, never touches existing data): it is required only for the *direct
anon-insert* fallback used when `apiBaseUrl` is empty.

If the admin itself shows "Não foi possível carregar os leads", check the
backend env instead: `SUPABASE_SERVICE_ROLE_KEY` must be set on the deployed
service (Render → your service → Environment).