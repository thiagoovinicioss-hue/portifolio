// Private lead store.
//
// Real mode: reads/writes the existing Supabase `leads` table with the SERVICE
// ROLE key (server-side only). This is why the private data stays protected:
// every request reaching here has already passed the server-side auth gate,
// and the service key never leaves this process.
//
// Mock mode (SUPABASE_MOCK=1, dev/tests only): in-memory replacement with the
// same shape as the schema in supabase/schema.sql.

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const VALID_STATUSES = ['new', 'contacted', 'negotiation', 'won', 'lost'];

// Columns the quote form is allowed to write (matches supabase/schema.sql).
// Insertions are filtered against the live table's actual columns (discovered
// once), so a stale/missing column never fails the whole lead insert.
const INSERTABLE_COLUMNS = [
  'name', 'company_name', 'company_type', 'contact', 'goals', 'objective',
  'how_it_works_today', 'biggest_pain', 'weekly_time_spent', 'previous_attempts',
  'budget', 'additional_info', 'selected_addons',
];

export function createLeadsStore(cfg) {
  if (cfg.supabase.mock) return createMockStore();
  return createSupabaseStore(cfg);
}

function createSupabaseStore(cfg) {
  if (!cfg.supabase.url || !cfg.supabase.serviceRoleKey) {
    return {
      error: 'supabase not configured',
      list: async () => { throw new Error('store_unconfigured'); },
      create: async () => { throw new Error('store_unconfigured'); },
      update: async () => { throw new Error('store_unconfigured'); },
      remove: async () => { throw new Error('store_unconfigured'); },
      ready: false,
    };
  }

  const db = createClient(cfg.supabase.url, cfg.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const table = cfg.supabase.leadsTable;

  // Lazy, cached discovery of the columns that actually exist on the live
  // table (re-probed periodically so newly added columns are picked up
  // without a redeploy). A stale/missing column must never fail the insert.
  const COLUMN_TTL_MS = 5 * 60 * 1000;
  let knownColumnsResult = null;
  let knownColumnsAt = 0;
  async function knownColumns() {
    const now = Date.now();
    if (!knownColumnsResult || now - knownColumnsAt > COLUMN_TTL_MS) {
      knownColumnsResult = await discoverColumns(db, table);
      knownColumnsAt = now;
    }
    return knownColumnsResult;
  }

  return {
    ready: true,
    async list() {
      const { data, error } = await db
        .from(table)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async create(row) {
      const existing = await knownColumns();
      const insertable = {};
      for (const field of INSERTABLE_COLUMNS) {
        if (existing.has(field) && Object.prototype.hasOwnProperty.call(row, field)) {
          insertable[field] = row[field];
        }
      }
      const { data, error } = await db.from(table).insert(insertable).select('id').single();
      if (error) throw error;
      return data;
    },
    async update(id, patch) {
      const { error } = await db.from(table).update(patch).eq('id', id);
      if (error) throw error;
    },
    async remove(id) {
      const { error } = await db.from(table).delete().eq('id', id);
      if (error) throw error;
    },
  };
}

async function discoverColumns(db, table, candidates = INSERTABLE_COLUMNS) {
  const existing = new Set();
  for (const column of candidates) {
    const { error } = await db.from(table).select(column).limit(0);
    if (!error) {
      existing.add(column);
    } else {
      // Column-not-found surfaces as either a PostgREST PGRST204 error or a raw
      // Postgres parse error depending on the query shape. Any other error is a
      // real failure (network/permissions) and must not be swallowed.
      const message = String(error.message || '');
      if (!/PGRST204|does not exist|Could not find the column/i.test(message)) throw error;
    }
  }
  return existing;
}

function createMockStore() {
  const rows = new Map();

  return {
    ready: true,
    async list() {
      return [...rows.values()]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    async create(row) {
      const record = {
        ...row,
        id: crypto.randomUUID(),
        status: row.status ?? 'new',
        created_at: new Date().toISOString(),
      };
      rows.set(record.id, record);
      return { id: record.id };
    },
    async update(id, patch) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...patch });
    },
    async remove(id) {
      rows.delete(id);
    },
    // Test helper: seed data.
    seed(row) {
      const id = crypto.randomUUID();
      const record = {
        id,
        name: row.name ?? 'Anonymous',
        company_name: row.company_name ?? null,
        company_type: row.company_type ?? null,
        goals: row.goals ?? null,
        objective: row.objective ?? null,
        budget: row.budget ?? null,
        details: row.details ?? null,
        additional_info: row.additional_info ?? null,
        status: row.status ?? 'new',
        created_at: new Date().toISOString(),
      };
      rows.set(id, record);
      return record;
    },
  };
}