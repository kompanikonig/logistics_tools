import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const STATUS_REPORT_FIELD = 'customfield_10335';

function issueKeyFromCab(cabUrl: string): string | null {
  const m = cabUrl.match(/([A-Za-z][A-Za-z0-9]*-\d+)\s*$/);
  return m ? m[1] : null;
}

function absolutizePaths(html: string, baseUrl: string): string {
  return html.replace(/(src|href)="\/(?!\/)/g, `$1="${baseUrl}/`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbSvc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const JIRA_BASE_URL = Deno.env.get('JIRA_BASE_URL')!;
  const JIRA_EMAIL = Deno.env.get('JIRA_EMAIL')!;
  const JIRA_API_TOKEN = Deno.env.get('JIRA_API_TOKEN')!;
  const auth = btoa(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`);

  const sb = createClient(sbUrl, sbSvc, { auth: { persistSession: false } });

  try {
    const { data: projects, error } = await sb.from('projects').select('id,cab_url').not('cab_url', 'is', null);
    if (error) throw error;

    let updated = 0;
    const errors: { project_id: string; issue?: string; error: string }[] = [];

    for (const p of projects || []) {
      const issueKey = issueKeyFromCab(p.cab_url || '');
      if (!issueKey) { errors.push({ project_id: p.id, error: 'не удалось извлечь номер тикета из cab_url' }); continue; }

      try {
        const res = await fetch(
          `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}?fields=${STATUS_REPORT_FIELD}&expand=renderedFields`,
          { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
        );
        if (!res.ok) { errors.push({ project_id: p.id, issue: issueKey, error: `Jira ${res.status}` }); continue; }
        const data = await res.json();
        let html: string | null = data.renderedFields?.[STATUS_REPORT_FIELD] ?? null;
        if (html) html = absolutizePaths(html, JIRA_BASE_URL);

        const { error: upErr } = await sb.from('projects').update({ status_report: html }).eq('id', p.id);
        if (upErr) { errors.push({ project_id: p.id, issue: issueKey, error: upErr.message }); continue; }
        updated++;
      } catch (e) {
        errors.push({ project_id: p.id, issue: issueKey, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, total: (projects || []).length, updated, errors }, null, 2),
      { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: CORS });
  }
});
