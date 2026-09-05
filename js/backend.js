import { CONFIG, isBackendConfigured } from './config.js';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let client = null;
let loadPromise = null;

async function ensureClient() {
  if (!isBackendConfigured()) return null;
  if (client) return client;
  if (!loadPromise) {
    loadPromise = import(/* webpackIgnore: true */ SUPABASE_CDN).then((mod) => {
      client = mod.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      return client;
    });
  }
  return loadPromise;
}

// ---- Quote form (public insert) ----
//
// Preferred path: POST through the authorized backend, which stores the lead
// with the service-role key server-side. That insert never depends on RLS
// policies in the Supabase dashboard, so a misconfigured DB can't silently
// swallow leads. Falls back to a direct anon-key insert only when no backend
// is configured (standalone mode).
export async function saveLead(payload) {
  const clean = {
    name: String(payload.name || '').slice(0, 120),
    company_name: String(payload.company_name || '').slice(0, 160),
    company_type: String(payload.company_type || '').slice(0, 100),
    contact: String(payload.contact || '').slice(0, 160),
    goals: String(payload.goals || '').slice(0, 100),
    objective: String(payload.objective || '').slice(0, 100),
    how_it_works_today: String(payload.how_it_works_today || '').slice(0, 2000),
    biggest_pain: String(payload.biggest_pain || '').slice(0, 2000),
    weekly_time_spent: String(payload.weekly_time_spent || '').slice(0, 500),
    previous_attempts: String(payload.previous_attempts || '').slice(0, 2000),
    budget: String(payload.budget || '').slice(0, 80),
    additional_info: String(payload.additional_info || '').slice(0, 2000),
    selected_addons: Array.isArray(payload.selected_addons)
      ? payload.selected_addons.slice(0, 8).map((x) => String(x).slice(0, 80))
      : [],
  };

  const { apiBaseUrl } = CONFIG.auth;
  if (apiBaseUrl) {
    let res;
    try {
      res = await fetch(`${apiBaseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(clean),
      });
    } catch (_) {
      throw new Error('unavailable');
    }
    if (res.status === 429) throw new Error('rate_limited');
    if (!res.ok) throw new Error(res.status >= 500 ? 'unavailable' : 'request_failed');
    const data = await res.json().catch(() => null);
    return data;
  }

  const supabase = await ensureClient();
  if (!supabase) throw new Error('backend not configured');
  const { data, error } = await supabase
    .from(CONFIG.supabase.leadsTable)
    .insert(clean)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ---- Private area (Supabase Auth + backend gateway) ----
//
// The browser authenticates with Supabase Auth (email/password) and keeps a
// persisted session for UE. That local state is ONLY for UX: the backend
// re-validates the access token server-side on EVERY private request and only
// serves data to the configured admin user. Dropping/expiring the token ends
// access without any client-side "isAuthenticated" flag.
//
// The service-role key never leaves the backend.

async function currentAccessToken() {
  const supabase = await ensureClient();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

async function api(path, opts = {}) {
  const { apiBaseUrl } = CONFIG.auth;
  if (!apiBaseUrl) throw new Error('unavailable');

  const token = opts.token !== undefined ? opts.token : await currentAccessToken();
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const options = { ...opts, headers };
  if (options.body !== undefined && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  let res;
  try {
    res = await fetch(`${apiBaseUrl}${path}`, options);
  } catch (_) {
    throw new Error('unavailable');
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* ignore */ }

  if (res.status === 401 || res.status === 403) throw new Error('unauthorized');
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error(res.status >= 500 ? 'unavailable' : 'request_failed');
  return data;
}

export async function signIn(email, password) {
  const supabase = await ensureClient();
  if (!supabase) throw new Error('unavailable');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/too many|rate limit|429/i.test(String(error.message))) throw new Error('rate_limited');
    // Generic on purpose — never reveal which credential was wrong.
    throw new Error('invalid_credentials');
  }
}

export async function signOut() {
  const supabase = await ensureClient();
  if (!supabase) return;
  await supabase.auth.signOut();
  // No backend session to clear: dropping the local token already ends access,
  // and the backend validates the token on every request anyway.
}

export async function getSession() {
  const token = await currentAccessToken();
  if (!token) return { authenticated: false, user: null };

  let data;
  try {
    data = await api('/api/session', { token });
  } catch (err) {
    // Expired/invalid token or not the admin -> treated as logged out. Only a
    // real outage propagates (fail-closed, the UI shows an error).
    if (err.message === 'unauthorized') return { authenticated: false, user: null };
    throw err;
  }
  return {
    authenticated: Boolean(data?.authenticated),
    user: data?.user || null,
  };
}

export async function fetchLeads() {
  const data = await api('/api/leads');
  return data?.leads || [];
}

export async function updateLeadStatus(id, status) {
  await api(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
}

export async function deleteLead(id) {
  await api(`/api/leads/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---- MFA (TOTP) ----

export async function getMFAStatus() {
  const supabase = await ensureClient();
  if (!supabase) throw new Error('unavailable');
  const { data } = await supabase.auth.getSession();
  const factors = await listFactors();
  const hasVerifiedTOTP = factors.some((f) => f.factor_type === 'totp' && f.status === 'verified');
  return { mfaEnabled: hasVerifiedTOTP, aal: data?.session?.aal || 'aal1' };
}

export async function listFactors() {
  const supabase = await ensureClient();
  if (!supabase) throw new Error('unavailable');
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data?.totp || [];
}

export async function getFactors() {
  return listFactors();
}

export async function challengeMFA(factorId) {
  const supabase = await ensureClient();
  if (!supabase) throw new Error('unavailable');
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error) throw error;
  return data;
}

export async function verifyMFA(factorId, challengeId, code) {
  const supabase = await ensureClient();
  if (!supabase) throw new Error('unavailable');
  const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
  if (error) throw error;
  return data;
}

export async function enrollMFA() {
  const supabase = await ensureClient();
  if (!supabase) throw new Error('unavailable');
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'Thiago Vinícius Portfolio',
    friendlyName: 'Admin',
  });
  if (error) throw error;
  return data;
}

export async function unEnrollMFA(factorId) {
  const supabase = await ensureClient();
  if (!supabase) throw new Error('unavailable');
  const { data, error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  return data;
}