# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small set of internal logistics-team tools, deployed as static pages on GitHub Pages
(`https://kompanikonig.github.io/logistics_tools/`). There is no build step, no package
manager, and no test suite — every tool is a single self-contained `.html` file with all
CSS/JS inline and zero external JS dependencies (only Google Fonts are pulled in via
`<link>`).

- `index.html` — landing page listing the available tools (a simple card grid).
- `dashboard-v2/index.html` — resource-loading dashboard ("Логистика 2026"), Supabase-backed CRUD
  rewrite of the original CSV-based dashboard (which has been retired — see below). KPIs, monthly
  heatmap, free-capacity / needs-resource panels, a merged project/executor timeline with
  drill-down modals, project/assignment CRUD, Jira status-report sync, and a business-analyst
  load tab.
- `standup/index.html` — daily team standup board with per-person task lists, day status
  (work/vacation/sick), a weekly progress panel, a manager summary view, and a day archive.
- `kanban/index.html` — Supabase-backed kanban board for team tasks (Новая/В работе/Трудности/
  Выполнено), drag-and-drop, due dates, comments. Password-gated like `dashboard-v2` (SHA-256),
  with two role passwords (admin: full CRUD, viewer: read-only) — see its architecture notes below.
- `shared.js` — small set of dependency-free helpers shared by the tools above (see below).

## Working locally

There's nothing to install or build. Just open the files. `dashboard-v2/index.html` and
`kanban/index.html` talk to Supabase over HTTPS (works fine under `file://`), but it's still
convenient to serve the repo root locally for relative links between tools, e.g.:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000/`.

Deployment is just pushing to `main` — GitHub Pages serves the repo root directly (no Actions
workflow, no `gh-pages` branch).

## `shared.js`

A top-level `shared.js`, included via `<script src="../shared.js">` in each tool (after the
Supabase/SheetJS CDN tags, before the tool's own inline `<script>`). Holds dependency-free pure
helpers duplicated across tools: `sha256()` (used by `dashboard-v2` and `kanban`'s SHA-256
password gate), `esc()`/`escAttr()` (HTML escaping), `initials()`. Deliberately does **not**
hold CSS variables or theme-toggle logic — each tool's `:root` color palette and theme mechanism
are intentionally different (different brand colors, different persistence keys), not
duplication to remove.

## `standup/index.html` architecture

- The team roster is hardcoded in `PEOPLE`, plus a special pseudo-user `MANAGER` ("Руководитель")
  that switches the UI into a read-only team-summary view instead of an editable card. "Who am I"
  is a `<select>` persisted to `localStorage` (`standup_me`); page access itself is gated by a
  real Supabase Auth login (`sb.auth.signInWithPassword`), unlike `dashboard-v2`/`kanban`'s
  static SHA-256 password scheme.
- Storage is abstracted behind `apiGetAll()`/`apiSave()` via `backend()`: if `CONFIG.url` is set,
  both read/write go through a Google Apps Script Web App (acting as a proxy/DB on top of a
  Google Sheet); if empty, it falls back to per-browser `localStorage` only (single device, not
  shared with the team) and shows a warning bar. The Apps Script backend code itself is not in
  this repo.
- Data syncs by polling (`POLL_MS`, currently 25s) and merging server rows into the local
  `cache`. `mergeRows()` deliberately skips overwriting *your own* record while you're actively
  editing it or a save is in flight (`saving` counter / `myFieldFocused()`), to avoid clobbering
  unsaved input with a stale poll response.
- Workday/holiday logic (`isWorkday`, used for the weekly panel) is driven by a hardcoded
  `HOLIDAYS_2026` set specific to the Russian 2026 production calendar — update this set (and
  the year in surrounding logic) if the tool is still in use in a later year.
- Per-task status (`wip`/`done`/`fail`/`moved`/`blocked`, with an optional free-text note) is
  edited through a small popover (`openTaskEditor`/`commitEditor`), not inline.

## Adding a new tool

Follow the existing pattern: a new top-level folder with its own self-contained `index.html`
(inline CSS/JS, no shared assets). Add a card to the grid in the root `index.html` — there's a
commented-out template block there for exactly this (look for `ШАБЛОН для нового инструмента`).

## Планы: переход дашборда на Supabase

Старый CSV-вьювер (`dashboard/index.html`, снимок `DATA` + live CSV из Google Sheets) был
заменён на `dashboard-v2/index.html` (Supabase, CRUD) и удалён из репозитория — он больше не
используется и не поддерживается.

**Архитектурные решения (зафиксированы):**
1. БД — **Supabase** (PostgreSQL + Auth + API + realtime), старт на Free-плане.
2. Google Sheets как источник данных убирается; вместо него — кнопка «Выгрузить в Excel» на сайте.
3. Роли через Supabase Auth:
   - `admin` — полный доступ;
   - `pm` (РП, руководитель проекта) — редактирование дат/назначений/процентов;
   - `lead` (тимлид) — только просмотр.
4. CRUD с сайта: создание проектов; добавление исполнителей и РП (в т.ч. из карточки проекта);
   назначения; редактирование дат/процентов; выравнивание загрузки.

**Черновик схемы БД:**
- `profiles` (id, email, full_name, role: admin/pm/lead)
- `resources` (id, name, competencies[], direction, active)
- `projects` (id, name, cab_url, manager_id, competency, status, direction)
- `assignments` (id, project_id, resource_id, start_date, end_date, alloc_percent, q1..q4, created_by)

Помесячная загрузка считается на лету из `assignments` (даты × %) — так же, как сейчас
`monthLoad()`/`execLoadMap()` считают её из CSV-строк; при миграции эта логика переносится на
запросы к Supabase, а не переписывается с нуля.

**Дорожная карта:**
1. ✅ Редизайн визуала (dashboard-v2: таймлайн, drill-модалка, периоды исполнителей)
2. ✅ Схема Supabase: таблицы projects / assignments / resources, пароль через SHA-256
3. ✅ Подключение Supabase: чтение через anon-ключ, авторизация без Supabase Auth
4. ✅ CRUD: проекты (создание/редактирование/удаление), назначения, несколько периодов, CAB-ссылки
5. ✅ Экспорт в Excel (SheetJS); синк в Smartsheet — отложен
6. ✅ Роли и права: admin / pm / lead через Supabase Auth + RLS (`profiles`, `supabase/migration_roles.sql`)
7. ⬜ Кросс-направленческая загрузка, дедлайны
8. ⬜ Инфографика для презентаций: визуальные карточки статуса проектов для встреч
9. ⬜ Статус проекта на встречах: отображение прогресса / RAG-статуса / ключевых дат
10. ✅ Стендап → Supabase: уже на `standup_days`/`standup_tasks` (не Google Sheets), кнопка выгрузки в Excel добавлена
11. ✅ Вкладка «Загрузка БА» объединена с «Детализацией» (2026-06-30) — была статичным JSON-снимком
    (`const BA`), не связанным с Supabase; исполнители БА (Троян/Куренная/Климова) теперь обычные
    `resources` с компетенцией «БА», их загрузка — обычные `assignments` с `project_id`, привязанным
    к реальным проектам (мэтчинг по CAB-тикету/названию). Вкладка рендерится тем же `renderPlan()`,
    что и «Детализация», просто предфильтрованным по `competency='БА'` — CRUD/drill/роли достались
    бесплатно. Половина-месячная сетка (1-15/15-30) заменена на единый период на задачу (та же
    точность, что у всех остальных назначений)

**Уровень A — план работ (запланировано, делаем на днях):**

Решено двигаться по «минимальному» уровню модернизации — закрыть реальные дыры без смены архитектуры
(см. обсуждение плюсов/минусов текущего стека и вариантов A/B/C). Конкретные задачи:

1. ✅ **Роли и права через Supabase Auth + RLS** (главный пункт, пункт 6 выше) — только
   `dashboard-v2` (projects/assignments/resources); `kanban` и `standup` не трогали, у них свои
   рабочие схемы доступа:
   - `profiles` (id, email, full_name, role: admin/pm/lead) — см. `supabase/migration_roles.sql`
   - Заведены реальные пользователи в Supabase Auth (РП — pm, тимлиды — lead, Компаниченко —
     admin); общий аккаунт `kvladislav2703@gmail.com` больше не нужен для входа в dashboard-v2
   - RLS на `projects` (admin: всё; pm/lead: только просмотр), `assignments` (admin+pm: всё;
     lead: просмотр), `resources` (admin: всё; pm: просмотр+создание нового исполнителя;
     lead: просмотр) — через `public.current_role()`
   - Менеджер (`manager`) проекта остался свободным текстом, не привязан к аккаунту; исполнители
     (`resources`) не входят в систему как пользователи — оба вопроса ниже закрыты этим решением
   - Логин dashboard-v2 переведён с общего SHA-256-пароля на персональные email+пароль
     (Supabase Auth, как в `standup`); смена пароля — через «Забыли пароль?» (recovery-ссылка на
     почту, без участия админа)
   - ✅ **Anon-доступ к `projects`/`assignments`/`resources` закрыт** (2026-06-28) — проверено:
     анонимный ключ получает пустой результат на чтение и `42501` на запись; авторизованные
     admin/pm/lead продолжают работать как раньше. Заодно закрыт anon-доступ и у `standup`
     (`standup_days`/`standup_tasks`) — там он не был частью этой задачи изначально, но политика
     была такой же открытой; у `standup` остаётся общий `authenticated`-доступ без ролей
     (`auth_full_days`/`auth_full_tasks`), это не менялось
   - ⬜ **`kanban` всё ещё полностью открыт anon-ключом** (`kanban_cards`/`kanban_comments`) —
     там нет Supabase Auth вообще, только SHA-256-пароль на уровне UI, который не защищает от
     прямого запроса к API. Закрыть тем же способом, что и dashboard-v2 (Auth + роли) — отдельная
     задача, отложена сознательно, чтобы не сломать инструмент без замены механизма входа
2. ✅ **Зафиксировать RLS-политики в git** — `supabase/policies.sql`, актуальный снимок политик по
   всем 9 таблицам (включая `profiles`/`activity_log`); переналожить одной командой:
   `npx supabase db query --linked -f supabase/policies.sql` (требует, чтобы перед этим хоть раз
   был применён `supabase/migration_roles.sql` — оттуда берётся функция `current_role()`)
3. ✅ **Вынести повторяющийся код** — `sha256()`, `esc()`/`escAttr()`, `initials()` вынесены в
   общий `shared.js` (см. раздел выше), подключаемый через `<script src>` в `dashboard-v2`,
   `standup`, `kanban`. CSS-переменные и тема/dark-mode оставлены как есть — у каждого
   инструмента свой фирменный цвет и механизм переключения, это не дубликат, а разный дизайн

**Правила на время переработки:**
- Каждое изменение коммитить в Git — это страховка для отката.

## Безопасность — открытые задачи

Разобрано вручную против чек-листа из внешней статьи про типичные дыры в приложениях,
написанных с ИИ. По приоритету:

1. ⬜ **`kanban` всё ещё полностью открыт anon-ключом** — нет Supabase Auth вообще, только
   SHA-256-пароль на уровне UI (см. пункт выше в «Уровень A» / пункт 1 этого раздела).
   Самый весомый оставшийся долг.
2. ⬜ **Edge Functions без rate limiting** — `sync-from-jira`/`sync-from-sheets` задеплоены с
   `verify_jwt=false` и `Access-Control-Allow-Origin: '*'`; вызвать может кто угодно без лимита,
   `sync-from-jira` при этом дёргает реальный Jira API по всем проектам разом
3. ⬜ **Журнал действий (`activity_log`) подделываем** — `actor_email`/`actor_name`/`actor_role`
   пишутся с клиента (`myProfile` в браузере), без проверки на сервере через `auth.uid()`/
   `auth.jwt()`; admin/pm может вписать в лог чужое имя
4. ✅ **XSS в dashboard-v2** (2026-06-29) — название проекта/имя исполнителя/имя РП вставлялись
   в HTML без `esc()`/`escAttr()` в ~15 местах (вкладка «Дашборд», вся «Детализация» включая
   title-атрибуты, drill-модалка, формы назначений, панели «Без назначения»/«Нужен ресурс»,
   обе тепловые карты). Проверено инъекцией `<img onerror>`/атрибут-разрыва через наведение —
   нигде не выполняется. `status_report` (сырой HTML из Jira) теперь дополнительно санитизируется
   в `sync-from-jira` на входе данных (вырезаются `<script>`/`<iframe>`/`on*=`/`javascript:`)
5. ⬜ **«Сырые» ошибки в `alert()`** — 9 мест в dashboard-v2, 3 в kanban показывают пользователю
   текст ошибки Postgres/PostgREST напрямую вместо нейтрального сообщения
6. ⬜ Мелочи: выключить самостоятельную регистрацию в Supabase Auth (`disable_signup`), сузить
   `profiles` SELECT для не-admin ролей
