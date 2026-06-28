-- RLS-политики для всех таблиц проекта logistics_tools.
-- Снято из Supabase Studio 2026-06-27 как зеркало текущего состояния — страховка от инцидентов
-- вроде того, что произошёл с kanban_cards (RLS включился без политик, панель легла с пустыми
-- данными). Идемпотентно: можно безопасно запускать повторно (DROP POLICY IF EXISTS перед каждым
-- CREATE POLICY). Применить одной командой:
--   npx supabase db query --linked -f supabase/policies.sql
--
-- Текущая модель доступа — полностью открытый anon-ключ (без ограничений по ролям). Авторизация на
-- уровне приложений (SHA-256 пароль в dashboard-v2/kanban, Supabase Auth в standup) — это контроль
-- входа в UI, а не RLS. Ограничение по ролям (admin/pm/lead через profiles) — отдельный, ещё не
-- реализованный пункт дорожной карты в CLAUDE.md.

alter table public.assignments     enable row level security;
alter table public.projects        enable row level security;
alter table public.resources       enable row level security;
alter table public.standup_days    enable row level security;
alter table public.standup_tasks   enable row level security;
alter table public.kanban_cards    enable row level security;
alter table public.kanban_comments enable row level security;

-- anon — полный доступ (читает/пишет каждый, у кого есть anon-ключ; это текущая модель для всех инструментов)
drop policy if exists anon_all on public.assignments;
create policy anon_all on public.assignments for all to anon using (true) with check (true);

drop policy if exists anon_all on public.projects;
create policy anon_all on public.projects for all to anon using (true) with check (true);

drop policy if exists anon_all on public.resources;
create policy anon_all on public.resources for all to anon using (true) with check (true);

drop policy if exists anon_all on public.standup_days;
create policy anon_all on public.standup_days for all to anon using (true) with check (true);

drop policy if exists anon_all on public.standup_tasks;
create policy anon_all on public.standup_tasks for all to anon using (true) with check (true);

drop policy if exists anon_all on public.kanban_cards;
create policy anon_all on public.kanban_cards for all to anon using (true) with check (true);

drop policy if exists anon_all on public.kanban_comments;
create policy anon_all on public.kanban_comments for all to anon using (true) with check (true);

-- authenticated — полный доступ (нужен standup/index.html, который входит через Supabase Auth,
-- не через anon-ключ; у kanban/dashboard-v2 авторизованных пользователей через Supabase Auth нет,
-- поэтому для kanban_cards/kanban_comments эта политика не заводится)
drop policy if exists auth_all_assignments on public.assignments;
create policy auth_all_assignments on public.assignments for all to authenticated using (true) with check (true);

drop policy if exists auth_all_projects on public.projects;
create policy auth_all_projects on public.projects for all to authenticated using (true) with check (true);

drop policy if exists auth_all_resources on public.resources;
create policy auth_all_resources on public.resources for all to authenticated using (true) with check (true);

drop policy if exists auth_full_days on public.standup_days;
create policy auth_full_days on public.standup_days for all to authenticated using (true) with check (true);

drop policy if exists auth_full_tasks on public.standup_tasks;
create policy auth_full_tasks on public.standup_tasks for all to authenticated using (true) with check (true);
