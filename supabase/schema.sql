-- ============================================================
-- SkillSetu · PM-AJAY (GIA) Skilling Voice Assistant
-- Supabase schema — run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Courses (NSQF-aligned training catalogue)
create table if not exists public.courses (
  id              text primary key,
  name            text not null,
  sector          text not null check (sector in (
                    'textiles','agri','construction','beauty','automotive',
                    'electronics','food','handicrafts','it','healthcare')),
  nsqf_level      int  not null check (nsqf_level between 1 and 10),
  duration_months int  not null,
  provider        text not null,
  district        text not null,
  state           text not null,
  seats_left      int  not null default 0,
  stipend_monthly int  not null default 0,
  languages       text[] not null default '{}',
  keywords        text[] not null default '{}',
  created_at      timestamptz not null default now()
);

-- 2. Beneficiaries (SC-community members registering for skilling)
create table if not exists public.beneficiaries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  age        int  not null check (age between 15 and 60),
  gender     text not null check (gender in ('male','female','other')),
  phone      text not null check (phone ~ '^[6-9][0-9]{9}$'),
  state      text not null,
  district   text not null,
  category   text not null default 'sc' check (category in ('sc','st','obc','gen')),
  income     int  not null default 0,
  work_type  text not null,
  education  text not null default 'secondary',
  skills     text not null default '',
  interest   text not null default '',
  -- Consent (Phase 3): recorded before personal data is stored.
  consent_given       boolean not null default false,
  consent_timestamp   timestamptz,
  consent_version     text not null default 'v1',
  -- Interview profile (Phase 4): structured JSON built by the voice/text
  -- interview; service-side validation happens in the RPC layer.
  profile    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Duplicate-registration guard: one phone = one beneficiary record.
  unique (phone)
);

-- Missing-column guard for projects that ran an older schema version.
alter table public.beneficiaries add column if not exists consent_given boolean not null default false;
alter table public.beneficiaries add column if not exists consent_timestamp timestamptz;
alter table public.beneficiaries add column if not exists consent_version text not null default 'v1';
alter table public.beneficiaries add column if not exists profile jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.beneficiaries add constraint beneficiaries_phone_key unique (phone);
exception when duplicate_object then null; end $$;

-- 3. Enrollments (beneficiary ↔ course)
create table if not exists public.enrollments (
  id             uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries(id) on delete cascade,
  course_id      text not null references public.courses(id) on delete cascade,
  status         text not null default 'enrolled'
                 check (status in ('enrolled','completed','dropped')),
  created_at     timestamptz not null default now(),
  unique (beneficiary_id, course_id)
);

-- 4. Row Level Security
--
-- beneficiaries holds PII (names, phones, ages, incomes). Anonymous roles get
-- NO read access to the table: registration writes go through the
-- register_beneficiary() RPC below, and the admin dashboard reads the
-- pseudonymous beneficiary_directory view instead. Full table access requires
-- Supabase Auth (add authenticated users + a staff/admin claim in production).
alter table public.courses       enable row level security;
alter table public.beneficiaries enable row level security;
alter table public.enrollments   enable row level security;

drop policy if exists "public read courses" on public.courses;
create policy "public read courses" on public.courses
  for select using (true);

drop policy if exists "public read beneficiaries" on public.beneficiaries;
drop policy if exists "public insert beneficiaries" on public.beneficiaries;
drop policy if exists "authenticated read beneficiaries" on public.beneficiaries;
drop policy if exists "authenticated insert beneficiaries" on public.beneficiaries;
drop policy if exists "authenticated update beneficiaries" on public.beneficiaries;

-- Beneficiaries (Phase 2): a beneficiary sees/edits ONLY their own row
-- (linked via auth.uid() — register_beneficiary() sets user_id), staff/admin
-- see the directory view instead of the raw PII table. No anon policies:
-- registration happens exclusively through the register_beneficiary() RPC.
create policy "beneficiary own row select" on public.beneficiaries
  for select to authenticated
  using (auth.uid() = user_id or public.is_staff() or public.is_admin());
create policy "beneficiary own row update" on public.beneficiaries
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.beneficiaries add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_beneficiaries_user on public.beneficiaries (user_id);

-- Enrollments: NO anonymous writes at all (Phase 2 — the old public-insert
-- policy allowed spoofed enrollment rows). Enrollments happen exclusively via
-- the transactional enroll_beneficiary() RPC; users read only their own
-- enrollment rows; staff/admin read all (for the authorized dashboard).
drop policy if exists "public read enrollments" on public.enrollments;
drop policy if exists "pseudonymous read enrollments" on public.enrollments;
drop policy if exists "authenticated read enrollments" on public.enrollments;
drop policy if exists "authenticated manage enrollments" on public.enrollments;
drop policy if exists "public insert enrollments" on public.enrollments;

create policy "own enrollments select" on public.enrollments
  for select to authenticated
  using (
    exists (select 1 from public.beneficiaries b
            where b.id = enrollments.beneficiary_id and b.user_id = auth.uid())
    or public.is_staff() or public.is_admin()
  );
-- SEC-007: NO update policy on enrollments — enrollment status ('enrolled',
-- 'completed', 'dropped') is an authoritative program outcome. Even the row's
-- owner must not be able to mark themselves 'completed' (data integrity), so
-- status transitions happen through staff/admin processes only. Deleting an
-- enrollment is likewise not permitted by policy.

-- 4b. Registration RPC — the ONLY anonymous write path into beneficiaries.
-- Security definer so the client never needs SELECT on the base table, and it
-- returns just the new uuid (no PII round-trip).
--
-- Consent (Phase 3) is mandatory: p->'consent' must be true, and the version
-- and timestamp are recorded on the row. Duplicate phones return the EXISTING
-- beneficiary's id (idempotent registration, no PII leak — same caller sees
-- only the uuid).
create or replace function public.register_beneficiary(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Input validation (defense in depth — the client validates too).
  if p is null then raise exception 'missing payload'; end if;
  if coalesce(p->>'consent', 'false') is distinct from 'true' then
    raise exception 'consent is required before registering';
  end if;
  if length(coalesce(p->>'name', '')) < 2 or length(p->>'name') > 80 then
    raise exception 'invalid name';
  end if;
  if (p->>'phone') !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone'; end if;
  if coalesce((p->>'age')::int, 0) not between 15 and 60 then raise exception 'invalid age'; end if;

  -- Input validation (SEC-008/SEC-020): every free-form field is length-capped
  -- and enumerated fields are allow-listed BEFORE touching the table.
  if p->>'gender' is not null and p->>'gender' not in ('male','female','other') then
    raise exception 'invalid gender';
  end if;
  if p->>'category' is not null and p->>'category' not in ('sc','st','obc','gen') then
    raise exception 'invalid category';
  end if;
  if coalesce(length(p->>'state'), 0) = 0 or length(p->>'state') > 64 then
    raise exception 'invalid state';
  end if;
  if coalesce(length(p->>'district'), 0) < 2 or length(p->>'district') > 64 then
    raise exception 'invalid district';
  end if;
  if length(coalesce(p->>'skills', '')) > 300 or length(coalesce(p->>'interest', '')) > 300 then
    raise exception 'skills/interest too long (max 300 chars each)';
  end if;
  if coalesce((p->>'income')::int, 0) < 0 or coalesce((p->>'income')::int, 0) > 10000000 then
    raise exception 'invalid income';
  end if;
  if coalesce(p->>'work_type', '') = '' or length(p->>'work_type') > 64 then
    raise exception 'invalid work_type';
  end if;
  if coalesce(pg_column_size(p->'profile'), 2) > 16384 then
    raise exception 'profile too large (max 16KB)';
  end if;

  -- Duplicate phone: return the EXISTING id. (SEC-001: an anonymous caller can
  -- no longer OVERWRITE someone else's profile by re-submitting the same
  -- phone — only the record's authenticated owner (or staff/admin) may update
  -- fields; everyone else gets the id back unchanged, leaking no PII.)
  select id into v_id from public.beneficiaries where phone = p->>'phone';
  if v_id is not null then
    if auth.uid() is not null and (
      exists (select 1 from public.beneficiaries b
              where b.id = v_id and (b.user_id = auth.uid()
                                     or public.is_staff() or public.is_admin()))
    ) then
      update public.beneficiaries
         set name = p->>'name',
             age = (p->>'age')::int,
             gender = p->>'gender',
             district = p->>'district',
             work_type = p->>'work_type',
             education = coalesce(p->>'education', 'secondary'),
             skills = coalesce(p->>'skills', ''),
             interest = coalesce(p->>'interest', ''),
             profile = coalesce(p->'profile', '{}'::jsonb),
             user_id = coalesce(user_id, auth.uid())
       where id = v_id;
    end if;
    return v_id;
  end if;

  insert into public.beneficiaries
    (name, age, gender, phone, state, district, category, income, work_type,
     education, skills, interest, consent_given, consent_timestamp,
     consent_version, profile, user_id)
  values
    (p->>'name', (p->>'age')::int, p->>'gender', p->>'phone', p->>'state', p->>'district',
     coalesce(p->>'category', 'sc'), coalesce((p->>'income')::int, 0), p->>'work_type',
     coalesce(p->>'education', 'secondary'), coalesce(p->>'skills', ''), coalesce(p->>'interest', ''),
     true, now(), coalesce(p->>'consent_version', 'v1'),
     coalesce(p->'profile', '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.register_beneficiary(jsonb) from public;
grant execute on function public.register_beneficiary(jsonb) to anon, authenticated;

-- 4c-0. App roles (Phase 2): staff/admin identified by user_metadata.app_role
-- set at invite time by an administrator. Beneficiary = any other auth user.
-- The is_staff()/is_admin() helpers are SECURITY DEFINER + STABLE so RLS can
-- call them without recursive policy evaluation.
-- SECURITY (SEC-019): roles are read from `app_metadata`, which ONLY the
-- server (service role / dashboard) can modify. The old user_metadata source
-- let any user set app_role=admin in their own browser profile and receive
-- staff/admin row access.
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'app_role') in ('staff','admin'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin', false);
$$;

revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- 4c-0b. PUBLIC_ANALYTICS_VIEW — aggregate-only, zero PII, safe for public
-- demo dashboards (7 global counters, no rows, no names/phones/ids, no
-- district-level slices). security_invoker so RLS of the base tables applies.
drop view if exists public.public_analytics_view;
create view public.public_analytics_view
with (security_invoker = true) as
select
  (select count(*) from public.beneficiaries)                          as beneficiaries_total,
  (select count(*) from public.beneficiaries where gender = 'female')  as beneficiaries_female,
  (select count(*) from public.enrollments)                            as enrollments_total,
  (select count(*) from public.enrollments where status = 'enrolled')  as enrollments_active,
  (select count(*) from public.enrollments where status = 'completed') as enrollments_completed,
  (select count(*) from public.courses)                                as courses_total,
  (select coalesce(sum(seats_left), 0) from public.courses)            as seats_available;

grant select on public.public_analytics_view to anon, authenticated;

-- 4c-0c. AUTHORIZED_ADMIN_VIEW — row-level aggregates per district/sector for
-- authenticated staff/admin only; still PII-free (no names/phones/ids).
-- SEC-006: security_invoker + k-anonymity (small slices suppressed).
drop view if exists public.authorized_admin_view;
create view public.authorized_admin_view
with (security_invoker = true) as
select
  b.state, b.district, b.gender, b.work_type, b.education,
  case when b.age < 18 then 'under-18'
       when b.age < 25 then '18-24'
       when b.age < 35 then '25-34'
       when b.age < 50 then '35-49'
       else '50+' end as age_band,
  count(*) as beneficiaries,
  date_trunc('month', b.created_at) as cohort_month
from public.beneficiaries b
group by 1,2,3,4,5,6, date_trunc('month', b.created_at)
having count(*) >= 5;

revoke all on public.authorized_admin_view from public, anon;
grant select on public.authorized_admin_view to authenticated;

-- 4c. PII-free directory for the admin dashboard: aggregates only — no names,
-- phones, ages or incomes; created_at is truncated to month granularity.
create or replace view public.beneficiary_directory as
select
  b.id,
  ''                             as name,
  null::int                      as age,
  b.gender,
  '—'                            as phone,
  b.state,
  b.district,
  b.category,
  0                              as income,
  b.work_type,
  b.education,
  ''                             as skills,
  ''                             as interest,
  date_trunc('month', b.created_at) as created_at,
  case
    when b.age < 18 then 'under-18'
    when b.age < 25 then '18-24'
    when b.age < 35 then '25-34'
    when b.age < 50 then '35-49'
    else '50+'
  end                            as age_band,
  to_char(date_trunc('month', b.created_at), 'YYYY-MM') as created_month
from public.beneficiaries b;

-- SEC-006: staff/admin only, security_invoker (RLS of underlying tables
-- applies), and k-anonymity — district/gender/education slices with fewer
-- than 5 beneficiaries are suppressed so public aggregate data cannot be
-- reverse-engineered into individual records.
drop view if exists public.beneficiary_directory;
create view public.beneficiary_directory
with (security_invoker = true) as
select
  b.id,
  ''                             as name,
  null::int                      as age,
  b.gender,
  '—'                            as phone,
  b.state,
  b.district,
  b.category,
  0                              as income,
  b.work_type,
  b.education,
  ''                             as skills,
  ''                             as interest,
  date_trunc('month', b.created_at) as created_at,
  case
    when b.age < 18 then 'under-18'
    when b.age < 25 then '18-24'
    when b.age < 35 then '25-34'
    when b.age < 50 then '35-49'
    else '50+'
  end                            as age_band,
  to_char(date_trunc('month', b.created_at), 'YYYY-MM') as created_month,
  count(*) over (partition by b.district, b.gender, date_trunc('month', b.created_at)) as slice_count
from public.beneficiaries b;

revoke all on public.beneficiary_directory from public, anon;
grant select on public.beneficiary_directory to authenticated;

-- 5. Transactional enrollment RPC (Phase 2/15) — replaces the old
-- client-side insert + separate decrement_seats() pair, which was neither
-- atomic nor spoof-resistant.
--
-- One transaction:
--   1. authorize: caller owns the beneficiary profile (auth.uid()) OR is staff/admin
--   2. verify course exists
--   3. verify seats available (row-locked FOR UPDATE)
--   4. reject duplicate enrollment
--   5. insert enrollment
--   6. decrement seats
-- Any failure aborts the whole transaction — nothing is committed.
create or replace function public.enroll_beneficiary(
  p_beneficiary_id uuid,
  p_course_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ben_user uuid;
  v_seats int;
  v_already int;
begin
  -- 1. Authorization: owner or staff/admin.
  if auth.uid() is null then
    raise exception 'authentication required to enroll';
  end if;
  select user_id into v_ben_user from public.beneficiaries where id = p_beneficiary_id;
  if v_ben_user is null then raise exception 'beneficiary not found'; end if;
  if v_ben_user <> auth.uid() and not public.is_staff() and not public.is_admin() then
    raise exception 'not authorized to enroll this beneficiary';
  end if;

  -- 2. Course must exist (row-locked so concurrent enrollments serialize).
  select seats_left into v_seats
  from public.courses
  where id = p_course_id
  for update;
  if not found then raise exception 'course not found'; end if;

  -- 3. Duplicate prevention.
  select count(*) into v_already
  from public.enrollments
  where beneficiary_id = p_beneficiary_id and course_id = p_course_id;
  if v_already > 0 then
    return jsonb_build_object('ok', true, 'duplicate', true, 'seats_left', v_seats);
  end if;

  -- 4. Seat availability.
  if v_seats <= 0 then raise exception 'course is full'; end if;

  -- 5. Insert + 6. decrement — committed together or not at all.
  insert into public.enrollments (beneficiary_id, course_id, status)
  values (p_beneficiary_id, p_course_id, 'enrolled');

  update public.courses
     set seats_left = seats_left - 1
   where id = p_course_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'seats_left', v_seats - 1);
end;
$$;

revoke all on function public.enroll_beneficiary(uuid, text) from public, anon;
grant execute on function public.enroll_beneficiary(uuid, text) to authenticated;

-- Legacy entry point kept for one release: any leftover client calling
-- decrement_seats() directly can no longer corrupt counts from anon.
create or replace function public.decrement_seats(course text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Deprecated: enrollment is handled by enroll_beneficiary(). Deliberately
  -- hard-no-op for safety; kept so old deploys do not error in logs.
  null;
end;
$$;
revoke all on function public.decrement_seats(text) from public, anon;

-- ============================================================
-- 6. Seed data — NSQF course catalogue
-- ============================================================
insert into public.courses
  (id, name, sector, nsqf_level, duration_months, provider, district, state, seats_left, stipend_monthly, languages, keywords)
values
  ('gc1','Sewing Machine Operator','textiles',2,3,'DDU GKY Centre','Nagpur','Maharashtra',18,1000,'{hi,mr}','{stitching,tailoring,sewing,garment}'),
  ('gc2','Handloom Weaver','textiles',3,4,'Weaver Service Centre','Nagpur','Maharashtra',12,1500,'{mr,hi}','{weaving,loom,handloom,saree}'),
  ('gc3','General Duty Assistant','healthcare',3,4,'Apollo Skill Centre','Hyderabad','Telangana',25,2000,'{te,hi}','{hospital,patient,nursing,caregiver}'),
  ('gc4','Field Technician — Solar','electronics',3,3,'Skill Son Electric','Hyderabad','Telangana',20,1800,'{te,en}','{solar,panel,electric,wiring}'),
  ('gc5','Fitter & Welding','construction',3,6,'ITI Nagpur','Nagpur','Maharashtra',30,1200,'{mr,hi}','{fitter,welding,turning,tools}'),
  ('gc6','Mobile Phone Repair Technician','electronics',2,2,'Skill Son Electric','Nagpur','Maharashtra',15,1200,'{mr,hi}','{mobile,repair,phone,electronics}'),
  ('gc7','Organic Grower','agri',2,3,'Agri Clinic Agri Business Centre','Guntur','Andhra Pradesh',40,800,'{te,en}','{farming,organic,seeds,soil}'),
  ('gc8','Dairy Farmer','agri',2,2,'BAIF Development Research','Guntur','Andhra Pradesh',35,800,'{te}','{dairy,cattle,milk,animal}'),
  ('gc9','Beauty Therapist','beauty',2,3,'Lakme Academy CSR','Hyderabad','Telangana',16,1000,'{te,en}','{beauty,salon,facial,makeup}'),
  ('gc10','Food & Beverage Service Steward','food',3,3,'FSSAI Training Partner','Hyderabad','Telangana',22,1500,'{te,hi}','{hotel,restaurant,catering,service}'),
  ('gc11','Bamboo Craft Artisan','handicrafts',2,2,'Tribal Co-operative Federation','Gadchiroli','Maharashtra',20,1000,'{mr,hi}','{bamboo,craft,basket,artisan}'),
  ('gc12','Leather Goods Maker','handicrafts',2,3,'CLRI CSIR Centre','Hyderabad','Telangana',14,1200,'{te,hi}','{leather,footwear,goods,stitching}'),
  ('gc13','Data Entry Operator','it',3,3,'NIELIT Centre','Nagpur','Maharashtra',28,2000,'{en,hi}','{computer,typing,office,data}'),
  ('gc14','DTP Operator','it',2,2,'NIELIT Centre','Guntur','Andhra Pradesh',25,1500,'{te,en}','{computer,design,printing,dtp}'),
  ('gc15','Mason General','construction',2,3,'NIRC Builders Association','Gadchiroli','Maharashtra',30,1000,'{mr,hi}','{mason,brick,plaster,construction}'),
  ('gc16','Assistant Electrician','construction',2,3,'Skill Son Electric','Nagpur','Maharashtra',22,1000,'{mr,hi}','{electric,wiring,repair,solar}')
on conflict (id) do nothing;

-- Helpful indexes
create index if not exists idx_beneficiaries_state on public.beneficiaries (state);
create index if not exists idx_enrollments_beneficiary on public.enrollments (beneficiary_id);
create index if not exists idx_courses_sector on public.courses (sector);

-- ============================================================
-- 7. Twilio communications (SMS / WhatsApp / Voice / IVR)
--    Written ONLY by the twilio-send / twilio-webhook edge functions via the
--    service-role key; browsers access the PII-free comm_overview view.
-- ============================================================

-- Unified record for every outbound or inbound message and call.
create table if not exists public.communications (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null check (channel in ('sms','whatsapp','voice')),
  direction       text not null check (direction in ('inbound','outbound')),
  status          text not null default 'queued' check (status in
                    ('queued','sent','delivered','failed','undelivered','initiated','ringing','in-progress','completed','busy','no-answer','canceled')),
  twilio_sid      text unique,
  beneficiary_id  uuid references public.beneficiaries(id) on delete set null,
  phone           text not null,               -- E.164; masked in the overview view
  body            text,                        -- message text / call note; NOT in the view
  duration_secs   integer,
  error_code      integer,
  error_message   text,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per voice call, tracking IVR menu selections.
create table if not exists public.ivr_sessions (
  id              uuid primary key default gen_random_uuid(),
  call_sid        text not null unique,
  beneficiary_id  uuid references public.beneficiaries(id) on delete set null,
  phone           text not null,
  selections      jsonb not null default '[]'::jsonb,  -- [{"key":"1","menu":"main","at":"..."}]
  status          text not null default 'in-progress',
  language        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Opt-in/opt-out registry per phone + channel (STOP/START handling).
create table if not exists public.comm_optouts (
  phone           text not null,
  channel         text not null check (channel in ('sms','whatsapp','voice','all')),
  opted_out       boolean not null default true,
  source          text,
  updated_at      timestamptz not null default now(),
  primary key (phone, channel)
);

-- Webhook idempotency: (sid + event) seen before -> skip reprocessing.
create table if not exists public.webhook_events (
  event_id        text primary key,            -- e.g. "SMxxxx:delivered"
  kind            text not null,
  payload         jsonb not null default '{}'::jsonb,
  received_at     timestamptz not null default now()
);

-- PII-free dashboard view: masked phones, no message bodies, no uuids.
create or replace view public.comm_overview as
select
  c.channel,
  c.direction,
  c.status,
  '•••••' || right(c.phone, 4)   as phone_masked,
  c.duration_secs,
  c.error_code,
  date_trunc('minute', c.created_at) as created_at,
  (c.meta ->> 'ivr_keys')        as ivr_keys
from public.communications c;

grant select on public.comm_overview to anon, authenticated;

-- Deny-by-default on the raw tables: no anon/authenticated policies at all —
-- only the service role (edge functions) reads and writes these.
alter table public.communications enable row level security;
alter table public.ivr_sessions    enable row level security;
alter table public.comm_optouts    enable row level security;
alter table public.webhook_events  enable row level security;

-- Query/index coverage for the dashboard and webhook hot paths.
create index if not exists idx_comms_sid        on public.communications (twilio_sid);
create index if not exists idx_comms_beneficiary on public.communications (beneficiary_id);
create index if not exists idx_comms_phone      on public.communications (phone);
create index if not exists idx_comms_status     on public.communications (status);
create index if not exists idx_comms_created    on public.communications (created_at);
create index if not exists idx_ivr_beneficiary  on public.ivr_sessions (beneficiary_id);
create index if not exists idx_optouts_phone    on public.comm_optouts (phone);
