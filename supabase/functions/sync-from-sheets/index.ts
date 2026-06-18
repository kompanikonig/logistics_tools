import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSDHUAox0LHpdGRUCLFBJTa5srE252_WlqTqxiak_yB7llEogAP5yawo0QtM9kri_LLynzl5CQZ-4Y2/pub?output=csv';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

const NAME_ALIASES: Record<string, string> = { 'хапаев дмитрий': 'Дмитрий Хапаев', 'без назначения': 'Без назначения' };
function normName(name: string): string {
  const key = name.trim().toLowerCase();
  if (NAME_ALIASES[key]) return NAME_ALIASES[key];
  return name.trim().split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function parseCSV(text: string): string[][] {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = []; let row: string[] = [], field = '', inQ = false, i = 0;
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

function buildFromCSV(text: string) {
  const rows = parseCSV(text).filter(r => r.some(c => c && c.trim() !== ''));
  if (!rows.length) throw new Error('пустой CSV');
  let hi = 0;
  for (let k = 0; k < Math.min(6, rows.length); k++) {
    const low = rows[k].map(x => (x || '').toLowerCase());
    if (low.some(x => x.includes('исполн') || x.includes('ресурс')) && low.some(x => x.includes('назв'))) { hi = k; break; }
  }
  const headers = rows[hi].map(x => (x || '').toLowerCase().trim());
  const find = (...keys: string[]) => headers.findIndex(hd => keys.some(k => hd.includes(k)));
  const idx = {
    project:    headers.findIndex(hd => hd.includes('назв') && !hd.includes('cab')),
    competency: find('компетен'), manager: find('руководит'),
    executor:   find('ресурс', 'исполн'), start: find('начал', 'дата нач'),
    end:        find('оконч', 'срок'),    alloc: find('выдел'),
    cab:        headers.findIndex(hd => hd.includes('номер') && hd.includes('cab')),
    q1: find('q1'), q2: find('q2'), q3: find('q3'), q4: find('q4'),
  };
  if (idx.project < 0) idx.project = find('назв');

  const num = (v: unknown): number => {
    let s = ('' + (v == null ? '' : v)).trim(); if (s === '') return 0;
    const pct = s.includes('%'); s = s.replace('%','').replace(/\s/g,'').replace(',','.');
    const n = parseFloat(s); return isNaN(n) ? 0 : (pct ? n/100 : n);
  };
  const dt = (v: unknown): string => {
    const sv = ('' + (v == null ? '' : v)).trim(); if (!sv) return '';
    const m = sv.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
    if (m) { const [,d,mo,y] = m; const yy = y.length===2?'20'+y:y; return yy+'-'+('0'+mo).slice(-2)+'-'+('0'+d).slice(-2); }
    const dd = new Date(sv); return isNaN(+dd) ? '' : dd.toISOString().slice(0,10);
  };
  const g = (r: string[], i: number) => (i >= 0 && i < r.length) ? r[i] : '';

  const recs = [];
  for (let k = hi+1; k < rows.length; k++) {
    const r = rows[k];
    const project  = (g(r, idx.project) || '').trim();
    const executor = (g(r, idx.executor) || '').trim() || 'Без назначения';
    const q1=num(g(r,idx.q1)), q2=num(g(r,idx.q2)), q3=num(g(r,idx.q3)), q4=num(g(r,idx.q4));
    if (!project && !q1 && !q2 && !q3 && !q4 && executor==='Без назначения') continue;
    const cabRaw = idx.cab>=0 ? (g(r,idx.cab)||'').trim() : '';
    recs.push({ project:project||'—', competency:(g(r,idx.competency)||'').trim()||'—',
      manager:(g(r,idx.manager)||'').trim()||'—', executor,
      cab: /^https?:\/\//i.test(cabRaw)?cabRaw:'', start:dt(g(r,idx.start)), end:dt(g(r,idx.end)),
      alloc:num(g(r,idx.alloc)), q1, q2, q3, q4 });
  }
  return recs;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // проверяем jwt пользователя
  const authHeader = req.headers.get('Authorization') ?? '';
  const sbUrl  = Deno.env.get('SUPABASE_URL')!;
  const sbAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const sbSvc  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userSb = createClient(sbUrl, sbAnon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const sb = createClient(sbUrl, sbSvc, { auth: { persistSession: false } });

  try {
    const resp = await fetch(CSV_URL);
    if (!resp.ok) throw new Error('CSV недоступен: ' + resp.status);
    const DATA = buildFromCSV(await resp.text());
    DATA.forEach(r => { r.executor = normName(r.executor); r.manager = normName(r.manager); });

    // resources
    const execComp: Record<string, Record<string, number>> = {};
    DATA.filter(r => r.executor !== 'Без назначения').forEach(r => {
      if (!execComp[r.executor]) execComp[r.executor] = {};
      const c = r.competency === 'РП' ? '__skip__' : r.competency;
      execComp[r.executor][c] = (execComp[r.executor][c]||0)+1;
    });
    const resourceRows = Object.entries(execComp).map(([name, cnt]) => {
      const e = Object.entries(cnt).filter(([c])=>c!=='__skip__').sort((a,b)=>b[1]-a[1]);
      return { name, competency: e.length ? e[0][0] : 'РП', active: true };
    });

    await sb.from('assignments').delete().neq('id','00000000-0000-0000-0000-000000000000');
    await sb.from('projects').delete().neq('id','00000000-0000-0000-0000-000000000000');
    await sb.from('resources').delete().neq('id','00000000-0000-0000-0000-000000000000');

    const { data: resources } = await sb.from('resources').insert(resourceRows).select('id,name');
    const rMap: Record<string,string> = {};
    (resources||[]).forEach((r:{id:string,name:string}) => rMap[r.name]=r.id);

    // projects
    const byP: Record<string, typeof DATA> = {};
    DATA.forEach(r => { if (!byP[r.project]) byP[r.project]=[]; byP[r.project].push(r); });
    const projectRows = Object.entries(byP).map(([name, rows]) => {
      const manager = rows.find(r=>r.manager)?.manager??'';
      const cCnt: Record<string,number>={};
      rows.forEach(r=>{ if(r.competency!=='РП') cCnt[r.competency]=(cCnt[r.competency]||0)+1; });
      const competency = Object.entries(cCnt).sort((a,b)=>b[1]-a[1])[0]?.[0]??'РП';
      const dates=rows.map(r=>r.start).filter(Boolean).sort();
      const ends =rows.map(r=>r.end).filter(Boolean).sort();
      return { name, manager, competency, status:'active', start_date:dates[0]??null, end_date:ends[ends.length-1]??null };
    });
    const { data: projects } = await sb.from('projects').insert(projectRows).select('id,name');
    const pMap: Record<string,string>={};
    (projects||[]).forEach((p:{id:string,name:string}) => pMap[p.name]=p.id);

    // assignments
    const assignmentRows = DATA.map(r => ({
      project_id:    pMap[r.project],
      resource_id:   r.executor==='Без назначения' ? null : (rMap[r.executor]??null),
      competency:    r.competency, cab_url: r.cab||null,
      start_date:    r.start||null, end_date: r.end||null, alloc_percent: r.alloc??0,
    }));
    await sb.from('assignments').insert(assignmentRows);

    return new Response(JSON.stringify({ ok:true, resources:resourceRows.length, projects:projectRows.length, assignments:assignmentRows.length }),
      { headers: { ...CORS, 'Content-Type':'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error:(e as Error).message }),
      { status:500, headers: { ...CORS, 'Content-Type':'application/json' } });
  }
});
