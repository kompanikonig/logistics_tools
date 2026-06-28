-- RLS-политики для всех таблиц проекта logistics_tools.
-- Снимок текущего состояния (обновлён 2026-06-28, после закрытия anon-доступа у dashboard-v2
-- и standup) — страховка от инцидентов вроде того, что произошёл с kanban_cards (RLS включился
-- без политик, панель легла с пустыми данными). Идемпотентно: можно безопасно запускать повторно
-- (DROP POLICY IF EXISTS перед каждым CREATE POLICY). Применить одной командой:
--   npx supabase db query --linked -f supabase/policies.sql
--
-- Модель доступа по инструментам:
-- - dashboard-v2 (projects/assignments/resources) — Supabase Auth, роли admin/pm/lead через
--   public.profiles + public.current_role() (см. supabase/migration_roles.sql). anon-доступ
--   закрыт.
-- - standup (standup_days/standup_tasks) — Supabase Auth, один общий логин на команду, без
--   разделения по ролям (кто вошёл — может всё). anon-доступ закрыт.
-- - kanban (kanban_cards/kanban_comments) — пока ТОЛЬКО anon-ключ + SHA-256-пароль на уровне UI
--   (admin/view), без Supabase Auth и без RLS-ограничений по ролям. Это осознанный временный
--   пробел — закрыть тем же способом, что и dashboard-v2, отдельным шагом.
--
-- Зависимость: функция public.current_role() должна существовать до применения этого файла
-- (создаётся в supabase/migration_roles.sql, применять один раз перед этим файлом).

alter table public.assignments     enable row level security;
alter table public.projects        enable row level security;
alter table public.resources       enable row level security;
alter table public.standup_days    enable row level security;
alter table public.standup_tasks   enable row level security;
alter table public.kanban_cards    enable row level security;
alter table public.kanban_comments enable row level security;
alter table public.profiles        enable row level security;
alter table public.activity_log    enable row level security;

-- ── kanban: anon — полный доступ (единственная защита — пароль на уровне UI, см. примечание выше)
drop policy if exists anon_all on public.kanban_cards;
create policy anon_all on public.kanban_cards for all to anon using (true) with check (true);

drop policy if exists anon_all on public.kanban_comments;
create policy anon_all on public.kanban_comments for all to anon using (true) with check (true);

-- ── standup: любой авторизованный (общий логин команды, без разделения по ролям)
drop policy if exists auth_full_days on public.standup_days;
create policy auth_full_days on public.standup_days for all to authenticated using (true) with check (true);

drop policy if exists auth_full_tasks on public.standup_tasks;
create policy auth_full_tasks on public.standup_tasks for all to authenticated using (true) with check (true);

-- ── profiles: каждый авторизованный видит весь справочник ролей (имя/email/роль)
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

-- ── dashboard-v2: роли через public.current_role() (admin/pm/lead) ──────────────────────────
-- projects: admin — всё; pm/lead — только просмотр
drop policy if exists role_admin_all_projects on public.projects;
create policy role_admin_all_projects on public.projects
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists role_view_projects on public.projects;
create policy role_view_projects on public.projects
  for select to authenticated
  using (public.current_role() in ('pm','lead'));

-- assignments: admin и pm — всё; lead — только просмотр
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

-- resources: admin — всё; pm — просмотр + добавление новых исполнителей; lead — только просмотр
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

-- ── activity_log: запись — admin/pm, чтение — только admin ──────────────────────────────────
drop policy if exists role_log_insert on public.activity_log;
create policy role_log_insert on public.activity_log
  for insert to authenticated
  with check (public.current_role() in ('admin','pm'));

drop policy if exists role_log_select on public.activity_log;
create policy role_log_select on public.activity_log
  for select to authenticated
  using (public.current_role() = 'admin');
