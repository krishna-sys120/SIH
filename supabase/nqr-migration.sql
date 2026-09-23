-- ============================================================
-- SkillSetu · Official NQR integration (NQR_INTEGRATION Phase 4/5/8/13/16/19)
-- Official National Qualification Register (NCVET, nqr.gov.in) data layer.
--
-- Run AFTER supabase/schema.sql in the Supabase SQL editor.
-- Import data with:  node scripts/nqr-import.mjs --fetch --db
--   (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars; the
--    service role is server-side only, never a VITE_ variable)
--
-- Design invariants:
--  • NQR records are PUBLIC qualification facts (no beneficiary PII — Phase 20)
--  • Writes: service role (importer) only; no anon/authenticated write policy
--    exists, so beneficiaries cannot modify NQR data even with the anon key
--  • Reads: anonymized columns via the nqr_qualification_public view
--  • Provenance is mandatory: source, source_url, source_record_id,
--    verification_status, last_verified_at, raw_source_hash on every row
-- ============================================================

-- 1. Official qualifications (Phase 4) — fields map 1:1 to the official
--    summary export; fields the export does not provide simply do not exist
--    here (no fabricated columns/values).
create table if not exists public.nqr_qualifications (
  id                       uuid primary key default gen_random_uuid(),
  -- Official identifiers (Phase 7 dedup keys)
  nqr_page_id              text,                    -- numeric id of the official detail page
  qualification_code       text not null unique,    -- official code, e.g. QG-02-TX-01927-2024-V1.1-TSC
  qualification_title      text not null,
  qualification_description text,
  -- Official classification
  sector_official          text not null,           -- official sector name as published
  nsqf_level_display       text not null,           -- official display value ("Level 4.5") — never altered
  nsqf_level_numeric       numeric(3,1) check (nsqf_level_numeric between 1 and 10),
  -- Hours (official values; NULL when the source has none)
  notional_hours_max       integer check (notional_hours_max between 1 and 10000),
  notional_hours_min       integer check (notional_hours_min between 1 and 10000),
  -- Versioning / validity (official values)
  version                  text,
  approval_date            date,
  valid_till               date,
  -- Bodies (as published)
  awarding_body            text,
  certifying_bodies        text,
  proposed_occupation      text,
  progression_pathway      text,
  qualification_type       text,
  adopted_qualification    text,
  training_delivery_hours  text,
  -- Phase 5 provenance — mandatory
  verification_status      text not null default 'OFFICIAL_UNCERTAIN'
                           check (verification_status in
                             ('OFFICIAL_ACTIVE','OFFICIAL_EXPIRED','OFFICIAL_ARCHIVED',
                              'OFFICIAL_UNCERTAIN','PROTOTYPE')),
  source                   text not null default 'NCVET_NQR'
                           check (source in ('NCVET_NQR')),
  source_url               text not null,           -- official detail page URL
  source_record_id         text not null,           -- official page id
  raw_source_hash          text not null,           -- content hash for Phase 17 sync
  -- Phase 17 synchronization bookkeeping
  first_seen_at            timestamptz not null default now(),
  last_seen_at             timestamptz not null default now(),
  last_verified_at         timestamptz not null default now(),
  imported_at              timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- Integrity: min/max hours coherence (mirrors importer validation)
  constraint nqr_hours_order check
    (notional_hours_min is null or notional_hours_max is null
     or notional_hours_min <= notional_hours_max),
  constraint nqr_validity_order check
    (approval_date is null or valid_till is null or approval_date <= valid_till)
);

comment on table public.nqr_qualifications is
  'Official NSQF qualifications imported from the National Qualification Register (nqr.gov.in, NCVET). Every field is copied from the official export; nothing is inferred. Read-only to all non-service roles.';

-- 2. Import audit log (Phase 7/17/18) — one row per import run.
create table if not exists public.nqr_import_runs (
  id                uuid primary key default gen_random_uuid(),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  source            text not null default 'NCVET_NQR',
  mode              text not null check (mode in ('file','fetch')),
  rows_total        integer not null default 0,
  rows_valid        integer not null default 0,
  rows_rejected     integer not null default 0,
  rows_upserted     integer not null default 0,
  rows_archived_missing integer not null default 0,
  counts_active     integer not null default 0,
  counts_expired    integer not null default 0,
  counts_archived   integer not null default 0,
  counts_uncertain  integer not null default 0,
  error_log         jsonb not null default '[]'::jsonb,
  triggered_by      text
);

-- 3. Row Level Security (Phase 19) — deny-by-default.
alter table public.nqr_qualifications enable row level security;
alter table public.nqr_import_runs    enable row level security;

-- NO insert/update/delete policies exist on either table: only the service
-- role (importer / edge functions) can write. Beneficiaries and staff cannot
-- modify NQR data — not even their own rows (there are none).

-- Public read of qualification facts is via the anonymized view below; the
-- base table itself grants no select to anon/authenticated.
revoke all on public.nqr_qualifications from anon, authenticated;
revoke all on public.nqr_import_runs from anon, authenticated;

-- 4. Anonymized public view (Phase 13/20): official qualification facts only.
--    search_path pinned; security_invoker = true so RLS of the base table
--    applies (service role sees all; others see what policies allow — for the
--    view we re-grant select explicitly).
drop view if exists public.nqr_qualification_public;
create view public.nqr_qualification_public
with (security_invoker = true) as
select
  qualification_code,
  qualification_title,
  sector_official,
  nsqf_level_display,
  nsqf_level_numeric,
  notional_hours_max,
  notional_hours_min,
  valid_till,
  awarding_body,
  proposed_occupation,
  qualification_type,
  verification_status,
  source,
  source_url,
  source_record_id,
  last_verified_at
from public.nqr_qualifications;

grant select on public.nqr_qualification_public to anon, authenticated;

-- 5. Admin summary (Phase 16) — SECURITY DEFINER, pinned search_path,
--    admin-only execution, aggregate counters only (no row data).
create or replace function public.nqr_admin_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_result jsonb;
begin
  v_is_admin := coalesce((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin', false);
  if not v_is_admin then
    raise exception 'admin role required';
  end if;

  select jsonb_build_object(
    'total',         (select count(*) from public.nqr_qualifications),
    'active',        (select count(*) from public.nqr_qualifications where verification_status = 'OFFICIAL_ACTIVE'),
    'expired',       (select count(*) from public.nqr_qualifications where verification_status = 'OFFICIAL_EXPIRED'),
    'archived',      (select count(*) from public.nqr_qualifications where verification_status = 'OFFICIAL_ARCHIVED'),
    'uncertain',     (select count(*) from public.nqr_qualifications where verification_status = 'OFFICIAL_UNCERTAIN'),
    'duplicates',    (select count(*) from (
                       select qualification_code from public.nqr_qualifications
                       group by qualification_code having count(*) > 1) d),
    'last_import',   (select max(finished_at) from public.nqr_import_runs),
    'import_runs',   (select count(*) from public.nqr_import_runs),
    'last_verified', (select max(last_verified_at) from public.nqr_qualifications)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.nqr_admin_summary() from public, anon, authenticated;
grant execute on function public.nqr_admin_summary() to authenticated;

-- 6. Search indexes (Phase 13): title prefix/equality, sector, level, status,
--    occupation substring. Full-text search is deliberately deferred until
--    the importer lands in DB mode at scale; these cover the app's queries.
create index if not exists idx_nqr_title          on public.nqr_qualifications (qualification_title);
create index if not exists idx_nqr_sector         on public.nqr_qualifications (sector_official);
create index if not exists idx_nqr_level          on public.nqr_qualifications (nsqf_level_numeric);
create index if not exists idx_nqr_status         on public.nqr_qualifications (verification_status);
create index if not exists idx_nqr_valid_till     on public.nqr_qualifications (valid_till);
create index if not exists idx_nqr_occupation     on public.nqr_qualifications (proposed_occupation);
create index if not exists idx_nqr_code           on public.nqr_qualifications (qualification_code);
create index if not exists idx_nqr_runs_started   on public.nqr_import_runs (started_at);

-- 7. pg_trgm similarity for fuzzy title search (optional but cheap; used by
--    the admin search). Guarded so re-runs are safe.
create extension if not exists pg_trgm;
create index if not exists idx_nqr_title_trgm
  on public.nqr_qualifications using gin (qualification_title gin_trgm_ops);
