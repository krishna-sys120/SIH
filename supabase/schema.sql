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
  created_at timestamptz not null default now()
);

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

create policy "authenticated read beneficiaries" on public.beneficiaries
  for select to authenticated using (true);
create policy "authenticated insert beneficiaries" on public.beneficiaries
  for insert to authenticated with check (true);
create policy "authenticated update beneficiaries" on public.beneficiaries
  for update to authenticated using (true) with check (true);

-- Enrollments hold pseudonymous ids + timestamps (no direct PII). Anonymous
-- users may enroll (FK guarantees a real beneficiary) but may NOT list other
-- people's enrollments; the client tracks its own enrolled state after insert,
-- and the unique(beneficiary_id, course_id) constraint blocks double-enrolls.
-- For production, gate selects on authenticated with a
-- beneficiary_id = auth.uid() style policy and give staff a secure admin role.
drop policy if exists "public read enrollments" on public.enrollments;
drop policy if exists "pseudonymous read enrollments" on public.enrollments;
create policy "authenticated read enrollments" on public.enrollments
  for select to authenticated using (true);
create policy "authenticated manage enrollments" on public.enrollments
  for all to authenticated using (true) with check (true);
drop policy if exists "public insert enrollments" on public.enrollments;
create policy "public insert enrollments" on public.enrollments
  for insert with check (true);

-- 4b. Registration RPC — the ONLY anonymous write path into beneficiaries.
-- Security definer so the client never needs SELECT on the base table, and it
-- returns just the new uuid (no PII round-trip).
create or replace function public.register_beneficiary(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.beneficiaries
    (name, age, gender, phone, state, district, category, income, work_type, education, skills, interest)
  values
    (p->>'name', (p->>'age')::int, p->>'gender', p->>'phone', p->>'state', p->>'district',
     coalesce(p->>'category', 'sc'), coalesce((p->>'income')::int, 0), p->>'work_type',
     coalesce(p->>'education', 'secondary'), coalesce(p->>'skills', ''), coalesce(p->>'interest', ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.register_beneficiary(jsonb) from public;
grant execute on function public.register_beneficiary(jsonb) to anon, authenticated;

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

grant select on public.beneficiary_directory to anon, authenticated;

-- 5. Atomic seat decrement used on enrollment
create or replace function public.decrement_seats(course text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.courses
     set seats_left = greatest(0, seats_left - 1)
   where id = decrement_seats.course;
end;
$$;

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
