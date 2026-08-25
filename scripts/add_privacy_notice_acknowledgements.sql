-- Run this migration in Supabase SQL Editor before deploying the privacy-notice code.
-- It records acknowledgement of a published Privacy Notice version. It is not a marketing-consent table.

create table if not exists public.privacy_notice_acknowledgements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_version text not null,
  acknowledged_at timestamptz not null default now(),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  unique (user_id, policy_version)
);

create index if not exists privacy_notice_acknowledgements_user_id_idx
  on public.privacy_notice_acknowledgements (user_id, acknowledged_at desc);

alter table public.privacy_notice_acknowledgements enable row level security;

revoke all on table public.privacy_notice_acknowledgements from public, anon, authenticated;
grant select, insert, update on table public.privacy_notice_acknowledgements to service_role;
grant usage, select on sequence public.privacy_notice_acknowledgements_id_seq to service_role;
