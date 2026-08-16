-- Product projections and feedback for the v4 aesthetic engine.
-- Source wardrobe, Best Match and vision records remain unchanged.

create table public.aesthetic_style_journals (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  stage text not null check (stage in ('starting', 'growing', 'established')),
  portrait text not null default '',
  chapters jsonb not null default '[]'::jsonb,
  snapshot_hash text not null,
  engine_version text not null,
  prompt_version text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.aesthetic_journal_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  journal_snapshot_hash text not null,
  chapter_id text not null,
  feedback text not null check (feedback in ('accurate', 'not_quite')),
  note text check (note is null or char_length(note) <= 1000),
  source_version text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, journal_snapshot_hash, chapter_id)
);

create table public.outfit_recommendation_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  recommendation_key text not null,
  event_type text not null check (event_type in ('impression', 'skipped', 'selected_for_wear', 'rejected', 'worn_satisfied', 'worn_unsatisfied', 'not_worn')),
  previous_state text not null check (previous_state in ('new', 'presented', 'selected', 'rejected', 'satisfied', 'unsatisfied', 'not_worn')),
  state text not null check (state in ('new', 'presented', 'selected', 'rejected', 'satisfied', 'unsatisfied', 'not_worn')),
  reason text check (reason is null or char_length(reason) <= 1000),
  recommendation_snapshot jsonb not null default '{}'::jsonb,
  engine_version text,
  snapshot_hash text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create index aesthetic_journal_feedback_owner_created_idx
  on public.aesthetic_journal_feedback(owner_id, created_at desc);
create index outfit_recommendation_events_owner_key_created_idx
  on public.outfit_recommendation_events(owner_id, recommendation_key, created_at desc);

alter table public.aesthetic_style_journals enable row level security;
alter table public.aesthetic_journal_feedback enable row level security;
alter table public.outfit_recommendation_events enable row level security;

create policy aesthetic_style_journals_owner_select
  on public.aesthetic_style_journals for select to authenticated
  using (owner_id = auth.uid());
create policy aesthetic_style_journals_owner_insert
  on public.aesthetic_style_journals for insert to authenticated
  with check (owner_id = auth.uid());
create policy aesthetic_style_journals_owner_update
  on public.aesthetic_style_journals for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy aesthetic_journal_feedback_owner_select
  on public.aesthetic_journal_feedback for select to authenticated
  using (owner_id = auth.uid());
create policy aesthetic_journal_feedback_owner_insert
  on public.aesthetic_journal_feedback for insert to authenticated
  with check (owner_id = auth.uid());

create policy outfit_recommendation_events_owner_select
  on public.outfit_recommendation_events for select to authenticated
  using (owner_id = auth.uid());
create policy outfit_recommendation_events_owner_insert
  on public.outfit_recommendation_events for insert to authenticated
  with check (owner_id = auth.uid());

revoke all on public.aesthetic_style_journals, public.aesthetic_journal_feedback, public.outfit_recommendation_events from anon, public;
grant select, insert, update on public.aesthetic_style_journals to authenticated;
grant select, insert on public.aesthetic_journal_feedback, public.outfit_recommendation_events to authenticated;
