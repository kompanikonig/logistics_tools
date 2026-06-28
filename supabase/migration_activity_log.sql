-- Журнал действий dashboard-v2: кто/что/когда менял (проекты, назначения, исполнители).
-- Безопасно применять повторно. Применить: npx supabase db query --linked -f supabase/migration_activity_log.sql

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_email text,
  actor_name text,
  actor_role text,
  action text not null,       -- create / update / delete / deactivate / activate
  entity text not null,       -- project / assignment / resource
  entity_name text
);

alter table public.activity_log enable row level security;

drop policy if exists role_log_insert on public.activity_log;
create policy role_log_insert on public.activity_log
  for insert to authenticated
  with check (public.current_role() in ('admin','pm'));

drop policy if exists role_log_select on public.activity_log;
create policy role_log_select on public.activity_log
  for select to authenticated
  using (public.current_role() = 'admin');
