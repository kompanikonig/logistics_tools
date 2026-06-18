#!/usr/bin/env node
/**
 * Seed script: читает актуальный CSV из Google Sheets и заливает данные
 * в таблицы Supabase (resources, projects, assignments).
 *
 * Запуск:
 *   SUPABASE_URL="https://xxx.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
 *   node migrate/seed.mjs
 *
 * Повторный запуск безопасен — очищает таблицы перед вставкой.
 */

import { createClient } from '@supabase/supabase-js';

// ── конфиг ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Нужны переменные SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSDHUAox0LHpdGRUCLFBJTa5srE252_WlqTqxiak_yB7llEogAP5yawo0QtM9kri_LLynzl5CQZ-4Y2/pub?output=csv';

// ── CSV парсер ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = []; let row = [], field = '', inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"')  { inQ = true; i++; continue; }
    if (c === ',')  { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function buildFromCSV(text) {
  const rows = parseCSV(text).filter(r => r.some(c => c && c.trim() !== ''));
  if (!rows.length) throw new Error('пустой CSV');

  // ищем строку-заголовок
  let hi = 0;
  for (let k = 0; k < Math.min(6, rows.length); k++) {
    const low = rows[k].map(x => (x || '').toLowerCase());
    if (low.some(x => x.includes('исполн') || x.includes('ресурс')) && low.some(x => x.includes('назв'))) { hi = k; break; }
  }
  const headers = rows[hi].map(x => (x || '').toLowerCase().trim());
  const find = (...keys) => headers.findIndex(hd => keys.some(k => hd.includes(k)));

  const idx = {
    project:    headers.findIndex(hd => hd.includes('назв') && !hd.includes('cab')),
    competency: find('компетен'),
    manager:    find('руководит'),
    executor:   find('ресурс', 'исполн'),
    start:      find('начал', 'дата нач'),
    end:        find('оконч', 'срок'),
    alloc:      find('выдел'),
    cab:        headers.findIndex(hd => hd.includes('номер') && hd.includes('cab')),
    q1: find('q1'), q2: find('q2'), q3: find('q3'), q4: find('q4'),
  };
  if (idx.project < 0) idx.project = find('назв');

  const num = v => {
    let s = ('' + (v == null ? '' : v)).trim();
    if (s === '') return 0;
    const pct = s.includes('%');
    s = s.replace('%', '').replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(s);
    if (isNaN(n)) return 0;
    return pct ? n / 100 : n;
  };
  const dt = v => {
    v = ('' + (v == null ? '' : v)).trim();
    if (!v) return '';
    const m = v.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
    if (m) { let [,d,mo,y] = m; if (y.length === 2) y = '20' + y; return y + '-' + ('0'+mo).slice(-2) + '-' + ('0'+d).slice(-2); }
    const dd = new Date(v); return isNaN(+dd) ? '' : dd.toISOString().slice(0, 10);
  };
  const g = (r, i) => (i >= 0 && i < r.length) ? r[i] : '';

  const recs = [];
  for (let k = hi + 1; k < rows.length; k++) {
    const r = rows[k];
    const project  = (g(r, idx.project) || '').trim();
    const executor = (g(r, idx.executor) || '').trim() || 'Без назначения';
    const q1 = num(g(r, idx.q1)), q2 = num(g(r, idx.q2)), q3 = num(g(r, idx.q3)), q4 = num(g(r, idx.q4));
    if (!project && !q1 && !q2 && !q3 && !q4 && executor === 'Без назначения') continue;
    const cabRaw = idx.cab >= 0 ? (g(r, idx.cab) || '').trim() : '';
    recs.push({
      project:    project || '—',
      competency: (g(r, idx.competency) || '').trim() || '—',
      manager:    (g(r, idx.manager)    || '').trim() || '—',
      executor,
      cab:   /^https?:\/\//i.test(cabRaw) ? cabRaw : '',
      start: dt(g(r, idx.start)),
      end:   dt(g(r, idx.end)),
      alloc: num(g(r, idx.alloc)),
      q1, q2, q3, q4,
    });
  }
  if (!recs.length) throw new Error('строки не распознаны');
  return recs;
}

// ── нормализация имён ─────────────────────────────────────────────────────────
const NAME_ALIASES = {
  'хапаев дмитрий': 'Дмитрий Хапаев',
  'без назначения': 'Без назначения',
};
function normName(name) {
  const key = name.trim().toLowerCase();
  if (NAME_ALIASES[key]) return NAME_ALIASES[key];
  return name.trim().split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── загружаем CSV ─────────────────────────────────────────────────────────────
console.log('Загружаем CSV из Google Sheets…');
const resp = await fetch(CSV_URL);
if (!resp.ok) { console.error('Ошибка загрузки CSV:', resp.status); process.exit(1); }
const csvText = await resp.text();
const DATA = buildFromCSV(csvText);
console.log(`Строк из CSV: ${DATA.length}`);

DATA.forEach(r => { r.executor = normName(r.executor); r.manager = normName(r.manager); });

// ── Supabase ──────────────────────────────────────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function ok(label, { error, data }) {
  if (error) { console.error(`  ✗ ${label}:`, error.message); process.exit(1); }
  const n = Array.isArray(data) ? data.length : 1;
  console.log(`  ✓ ${label}: ${n} записей`);
  return data;
}

// ── 1. resources ──────────────────────────────────────────────────────────────
console.log('\n── 1. resources ──');
const execCompCount = {};
DATA.filter(r => r.executor !== 'Без назначения').forEach(r => {
  if (!execCompCount[r.executor]) execCompCount[r.executor] = {};
  const c = r.competency === 'РП' ? '__skip__' : r.competency;
  execCompCount[r.executor][c] = (execCompCount[r.executor][c] || 0) + 1;
});
const resourceRows = Object.entries(execCompCount).map(([name, counts]) => {
  const entries = Object.entries(counts).filter(([c]) => c !== '__skip__');
  const competency = entries.length ? entries.sort((a,b) => b[1]-a[1])[0][0] : 'РП';
  return { name, competency, active: true };
});

ok('truncate assignments', await sb.from('assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000'));
ok('truncate projects',    await sb.from('projects').delete().neq('id',    '00000000-0000-0000-0000-000000000000'));
ok('truncate resources',   await sb.from('resources').delete().neq('id',   '00000000-0000-0000-0000-000000000000'));

const resources = ok('insert resources', await sb.from('resources').insert(resourceRows).select());
const resourceMap = {};
resources.forEach(r => resourceMap[r.name] = r.id);
console.log(`  map: ${Object.keys(resourceMap).length} исполнителей`);

// ── 2. projects ───────────────────────────────────────────────────────────────
console.log('\n── 2. projects ──');
const byProject = {};
DATA.forEach(r => { if (!byProject[r.project]) byProject[r.project] = []; byProject[r.project].push(r); });

const projectRows = Object.entries(byProject).map(([name, rows]) => {
  const manager = rows.find(r => r.manager)?.manager ?? '';
  const cCount = {};
  rows.forEach(r => { if (r.competency !== 'РП') cCount[r.competency] = (cCount[r.competency]||0)+1; });
  const competency = Object.entries(cCount).sort((a,b) => b[1]-a[1])[0]?.[0] ?? 'РП';
  const dates = rows.map(r => r.start).filter(Boolean).sort();
  const ends  = rows.map(r => r.end).filter(Boolean).sort();
  return { name, manager, competency, status: 'active', start_date: dates[0] ?? null, end_date: ends[ends.length-1] ?? null };
});

const projects = ok('insert projects', await sb.from('projects').insert(projectRows).select());
const projectMap = {};
projects.forEach(p => projectMap[p.name] = p.id);
console.log(`  map: ${Object.keys(projectMap).length} проектов`);

// ── 3. assignments ────────────────────────────────────────────────────────────
console.log('\n── 3. assignments ──');
const assignmentRows = DATA.map(r => ({
  project_id:    projectMap[r.project],
  resource_id:   r.executor === 'Без назначения' ? null : (resourceMap[r.executor] ?? null),
  competency:    r.competency,
  cab_url:       r.cab  || null,
  start_date:    r.start || null,
  end_date:      r.end   || null,
  alloc_percent: r.alloc ?? 0,
}));

const missing = assignmentRows.filter(a => !a.project_id);
if (missing.length) console.warn(`  ⚠ не найден project_id для ${missing.length} строк`);

ok('insert assignments', await sb.from('assignments').insert(assignmentRows).select());

// ── итог ──────────────────────────────────────────────────────────────────────
console.log('\n── готово ──');
console.log(`  resources:   ${resourceRows.length}`);
console.log(`  projects:    ${projectRows.length}`);
console.log(`  assignments: ${assignmentRows.length}`);
