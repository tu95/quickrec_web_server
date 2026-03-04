-- Multi-user recorder schema for Supabase
-- Apply in Supabase SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.recorder_devices (
  id uuid primary key default gen_random_uuid(),
  device_identity text not null unique,
  identity_source text not null default 'unknown',
  device_source text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.recorder_pair_codes (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.recorder_devices(id) on delete cascade,
  pair_code text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recorder_user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.recorder_devices(id) on delete cascade,
  status text not null default 'active',
  bound_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create table if not exists public.recorder_device_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.recorder_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_token text not null unique,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.recorder_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.recorder_devices(id) on delete cascade,
  file_name text not null,
  oss_key text not null,
  oss_url text not null,
  size_bytes bigint not null default 0,
  duration_sec integer not null default 0,
  sha256 text not null default '',
  status text not null default 'uploaded',
  created_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recorder_user_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recorder_pair_codes_device on public.recorder_pair_codes(device_id);
create index if not exists idx_recorder_pair_codes_status on public.recorder_pair_codes(status, expires_at);
with pending_ranked as (
  select
    id,
    row_number() over (partition by device_id order by created_at desc, id desc) as rn
  from public.recorder_pair_codes
  where status = 'pending'
)
update public.recorder_pair_codes as t
set status = 'replaced', updated_at = now()
where t.id in (
  select id
  from pending_ranked
  where rn > 1
);
create unique index if not exists uq_recorder_pair_codes_pending_device
  on public.recorder_pair_codes(device_id)
  where status = 'pending';
alter table public.recorder_pair_codes
  drop constraint if exists recorder_pair_codes_used_by_user_id_fkey;
alter table public.recorder_pair_codes
  add constraint recorder_pair_codes_used_by_user_id_fkey
  foreign key (used_by_user_id) references auth.users(id) on delete set null;
create index if not exists idx_recorder_user_devices_user on public.recorder_user_devices(user_id);
create unique index if not exists uq_recorder_user_devices_active_device
  on public.recorder_user_devices(device_id)
  where status = 'active';
create index if not exists idx_recorder_device_sessions_device on public.recorder_device_sessions(device_id);
create index if not exists idx_recorder_device_sessions_token on public.recorder_device_sessions(session_token);
create index if not exists idx_recorder_recordings_user on public.recorder_recordings(user_id, created_at desc);
create index if not exists idx_recorder_recordings_device on public.recorder_recordings(device_id, created_at desc);

alter table public.recorder_user_devices enable row level security;
alter table public.recorder_recordings enable row level security;
alter table public.recorder_user_configs enable row level security;

drop policy if exists "user can read own devices" on public.recorder_user_devices;
create policy "user can read own devices"
  on public.recorder_user_devices
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "user can read own recordings" on public.recorder_recordings;
create policy "user can read own recordings"
  on public.recorder_recordings
  for select
  using ((select auth.uid()) = user_id);

-- Optional: allow users to update status in future extension
drop policy if exists "user can update own recordings" on public.recorder_recordings;
create policy "user can update own recordings"
  on public.recorder_recordings
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user can read own configs" on public.recorder_user_configs;
create policy "user can read own configs"
  on public.recorder_user_configs
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "user can insert own configs" on public.recorder_user_configs;
create policy "user can insert own configs"
  on public.recorder_user_configs
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "user can update own configs" on public.recorder_user_configs;
create policy "user can update own configs"
  on public.recorder_user_configs
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
