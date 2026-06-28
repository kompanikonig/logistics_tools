-- Миграция: роли admin/pm/lead через Supabase Auth + RLS для dashboard-v2
-- (projects/assignments/resources). Часть "Уровня A" дорожной карты в CLAUDE.md.
--
-- Безопасно применять повторно (create table if not exists, drop policy if exists перед create).
-- НЕ убирает текущий anon-доступ — старый SHA-256-логин dashboard-v2 продолжает работать на
-- anon-ключе, пока новый Auth-логин не протестирован и не подтверждён рабочим. Снятие anon-доступа
-- — отдельный, осознанный финальный шаг (см. supabase/policies.sql).
--
-- Применить: npx supabase db query --linked -f supabase/migration_roles.sql

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('admin','pm','lead')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

-- хелпер: роль текущего пользователя. security definer — чтобы не упереться в RLS profiles
-- при проверке роли внутри политик других таблиц.
create or replace function public.current_role()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ── projects: admin полный доступ, pm/lead — только просмотр ────────────────
drop policy if exists auth_all_projects on public.projects;        -- старая открытая authenticated-политика, неактуальна

drop policy if exists role_admin_all_projects on public.projects;
create policy role_admin_all_projects on public.projects
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists role_view_projects on public.projects;
create policy role_view_projects on public.projects
  for select to authenticated
  using (public.current_role() in ('pm','lead'));

-- ── assignments: admin и pm — полный доступ (даты/назначения/% — основная зона pm), lead — просмотр
drop policy if exists auth_all_assignments on public.assignments;  -- старая открытая authenticated-политика, неактуальна

drop policy if exists role_admin_all_assignments on public.assignments;
create policy role_admin_all_assignments on public.assignments
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists role_pm_all_assignments on public.assignments;
create policy role_pm_all_assignments on public.assignments
  for all to authenticated
  using (public.current_role() = 'pm')
  with check (public.current_role() = 'pm');

drop policy if exists role_lead_view_assignments on public.assignments;
create policy role_lead_view_assignments on public.assignments
  for select to authenticated
  using (public.current_role() = 'lead');

-- ── resources: admin — полный доступ, pm — просмотр + добавление новых исполнителей, lead — просмотр
drop policy if exists auth_all_resources on public.resources;      -- старая открытая authenticated-политика, неактуальна

drop policy if exists role_admin_all_resources on public.resources;
create policy role_admin_all_resources on public.resources
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists role_view_resources on public.resources;
create policy role_view_resources on public.resources
  for select to authenticated
  using (public.current_role() in ('pm','lead'));

drop policy if exists role_pm_insert_resources on public.resources;
create policy role_pm_insert_resources on public.resources
  for insert to authenticated
  with check (public.current_role() = 'pm');
