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

## `standup/index.html` architecture

- The team roster is hardcoded in `PEOPLE`, plus a special pseudo-user `MANAGER` ("Руководитель")
  that switches the UI into a read-only team-summary view instead of an editable card. There is
  no authentication — "who am I" is just a `<select>` persisted to `localStorage` (`standup_me`).
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
6. ⬜ Роли и права: admin / pm / lead через Supabase Auth + RLS
7. ⬜ Кросс-направленческая загрузка, дедлайны
8. ⬜ Инфографика для презентаций: визуальные карточки статуса проектов для встреч
9. ⬜ Статус проекта на встречах: отображение прогресса / RAG-статуса / ключевых дат
10. ✅ Стендап → Supabase: уже на `standup_days`/`standup_tasks` (не Google Sheets), кнопка выгрузки в Excel добавлена

**Уровень A — план работ (запланировано, делаем на днях):**

Решено двигаться по «минимальному» уровню модернизации — закрыть реальные дыры без смены архитектуры
(см. обсуждение плюсов/минусов текущего стека и вариантов A/B/C). Конкретные задачи:

1. **Роли и права через Supabase Auth + RLS** (главный пункт, пункт 6 выше):
   - Создать `profiles` (id, email, full_name, role: admin/pm/lead)
   - Завести реальных пользователей в Supabase Auth (не общий аккаунт `kvladislav2703@gmail.com`)
   - Написать RLS-политики на `projects`/`assignments`/`resources` на основе роли из `profiles`,
     а не открытый `anon`-доступ (которым всё работает сейчас)
   - На каждое приложение/роль — свой отдельный логин (как обсуждали: разные пароли по рангам)
2. **Зафиксировать RLS-политики в git**, а не только в Supabase Studio — отдельный `.sql` файл
   в репозитории, который можно переналожить одной командой (страховка от инцидентов вроде
   сегодняшнего, когда RLS включился без политик и обе панели легли с пустыми данными)
3. **Вынести повторяющийся код** (тема/dark-mode, sha256-хелпер, CSS-переменные, верстка
   login-оверлея) из `dashboard-v2/index.html` и `standup/index.html` в общий
   `shared.js`/`shared.css`, подключаемый через `<script src>`/`<link>` — без сборки, без npm,
   просто общий файл вместо копипасты

**Правила на время переработки:**
- Каждое изменение коммитить в Git — это страховка для отката.

**Открытые вопросы (пока не решены):**
- РП — это пользователь с логином (запись в `profiles`) или просто имя-справочник (как сейчас,
  текстом в поле `manager`)?
- Исполнители (`resources`) входят в систему как пользователи или остаются только объектами
  планирования, на которые ссылаются `assignments`?
