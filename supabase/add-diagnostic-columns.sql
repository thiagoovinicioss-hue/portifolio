-- ============================================================
-- Migration for existing installations whose "leads" table was
-- created before the diagnostic questions were introduced.
--
-- Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
-- Adds the columns used by the quote form that may be missing.
-- ============================================================

alter table public.leads
  add column if not exists how_it_works_today text,
  add column if not exists biggest_pain text,
  add column if not exists weekly_time_spent text,
  add column if not exists previous_attempts text,
  add column if not exists selected_addons text[] not null default '{}';