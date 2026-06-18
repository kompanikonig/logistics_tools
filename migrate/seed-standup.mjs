#!/usr/bin/env node
/**
 * Миграция стендап-данных из Google Apps Script → Supabase
 *
 * Запуск:
 *   SUPABASE_URL="https://xxx.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
 *   node migrate/seed-standup.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Нужны переменные SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzebEgXzL8A0g0R3F1s8LMpmyhhp4ttjAToCwZ9YYZ6xLpq3xK3CK5rNcL8Lm-bZob1/exec';

console.log('Загружаем данные из Google Apps Script…');
let rows;
try {
  const res = await fetch(APPS_SCRIPT_URL, { method: 'GET' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'read failed');
  rows = data.rows || [];
} catch (e) {
  console.error('Ошибка загрузки:', e.message);
  process.exit(1);
}
console.log(`Строк из Google Sheets: ${rows.length}`);

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Очищаем таблицы
console.log('\nОчищаем standup_tasks и standup_days…');
const { error: e1 } = await sb.from('standup_tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
if (e1) { console.error('Ошибка очистки tasks:', e1.message); process.exit(1); }
const { error: e2 } = await sb.from('standup_days').delete().neq('id', '00000000-0000-0000-0000-000000000000');
if (e2) { console.error('Ошибка очистки days:', e2.message); process.exit(1); }

// Вставляем дни
const dayRows = rows.map(r => ({
  person: r.person,
  date:   r.date,
  status: r.status || 'work',
  note:   r.note   || '',
}));

console.log(`Вставляем ${dayRows.length} записей standup_days…`);
const { error: e3 } = await sb.from('standup_days').insert(dayRows);
if (e3) { console.error('Ошибка вставки days:', e3.message); process.exit(1); }

// Вставляем задачи
const taskRows = [];
rows.forEach(r => {
  let tasks = [];
  try { tasks = JSON.parse(r.tasks || '[]'); } catch { tasks = []; }
  tasks.forEach((t, i) => {
    if (!t.text) return;
    taskRows.push({
      person:      r.person,
      date:        r.date,
      text:        t.text,
      task_status: t.st || 'wip',
      note:        t.note || '',
      sort_order:  i,
    });
  });
});

if (taskRows.length) {
  console.log(`Вставляем ${taskRows.length} задач standup_tasks…`);
  // Supabase insert batch limit ~1000, режем на чанки
  const CHUNK = 500;
  for (let i = 0; i < taskRows.length; i += CHUNK) {
    const chunk = taskRows.slice(i, i + CHUNK);
    const { error: e4 } = await sb.from('standup_tasks').insert(chunk);
    if (e4) { console.error('Ошибка вставки tasks:', e4.message); process.exit(1); }
    console.log(`  …вставлено ${Math.min(i + CHUNK, taskRows.length)} из ${taskRows.length}`);
  }
} else {
  console.log('Задач для переноса не найдено.');
}

console.log('\n── готово ──');
console.log(`  standup_days:  ${dayRows.length}`);
console.log(`  standup_tasks: ${taskRows.length}`);
