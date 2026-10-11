/**
 * Scheduled health check of the Google Sheet and the live app. Read-only: it never writes anywhere.
 *
 *   npx tsx scripts/monitor.ts
 *
 * Environment:
 *   SHEET_ID     the Google Sheet (default: the live sheet). It must be shared "Anyone with the link can view".
 *   APP_URL      the dashboard, e.g. https://example.com (optional: without it only the sheet is checked)
 *   MONITOR_KEY  the server's MONITOR_KEY (read-only key for /api/monitor)
 *
 * It rebuilds every agent's numbers from the sheet with the app's own code (server-clean-sheet.ts and
 * aggregateAgent) and compares them with what the app holds. Prints a Markdown report, also written to
 * monitor-report.md, ending with one line:  STATUS: OK  or  STATUS: ISSUES errors=N warnings=M
 */
import { writeFileSync } from 'fs';
import { buildFromCleanSheet, sheetDateTime } from '../server-clean-sheet';
import { aggregateAgent, normalizeEmail } from '../src/shared/incentive';

const SHEET_ID = process.env.SHEET_ID || '1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk';
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const MONITOR_KEY = process.env.MONITOR_KEY || '';
const TABS = { agentsRows: 'Agents', ordersRows: 'Orders', visitsRows: 'Visits', dialerRows: 'Dialer', preSalesRows: 'PreSales', qualityRows: 'Quality' } as const;
const LOCATIONS = ['dighe', 'andheri', 'bangalore'];
const TIERS = ['hocallers', 'storecallers', 'presales'];

type Issue = { level: 'error' | 'warn'; area: string; message: string };
const issues: Issue[] = [];
const error = (area: string, message: string) => issues.push({ level: 'error', area, message });
const warn = (area: string, message: string) => issues.push({ level: 'warn', area, message });
const info: string[] = [];

const key = (h: string) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const list = (xs: string[], max = 12) => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const header = (rows[0] || []).map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''] as [string, string]).filter(([h]) => h !== '')));
}

async function getText(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; type: string }> {
  const res = await fetch(url, { headers, redirect: 'follow' });
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') || '' };
}

async function readSheet(): Promise<Record<keyof typeof TABS, any[]> | null> {
  const view = await getText(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`);
  const gids = new Map<string, string>();
  for (const m of view.text.matchAll(/items\.push\(\{name: "([^"]*)", pageUrl: "[^"]*gid=(\d+)/g)) gids.set(m[1], m[2]);
  if (view.status !== 200 || gids.size === 0) {
    error('sheet', `Could not read the sheet's tab list (HTTP ${view.status}). Is it still shared as "Anyone with the link can view"?`);
    return null;
  }
  info.push(`Sheet tabs: ${[...gids.keys()].join(', ')}`);
  const out: any = {};
  for (const [field, tab] of Object.entries(TABS)) {
    const gid = gids.get(tab);
    if (!gid) {
      error('sheet', `Tab "${tab}" is missing (renamed or deleted?). The sync then treats its numbers as 0.`);
      out[field] = [];
      continue;
    }
    const csv = await getText(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`);
    if (csv.status !== 200 || !/csv|text\/plain/i.test(csv.type)) {
      error('sheet', `Tab "${tab}" could not be downloaded (HTTP ${csv.status}, ${csv.type}).`);
      out[field] = [];
      continue;
    }
    out[field] = parseCsv(csv.text);
  }
  return out;
}

function sheetChecks(tabs: Record<keyof typeof TABS, any[]>) {
  // Spreadsheet errors in any cell
  const bad: string[] = [];
  for (const [field, tab] of Object.entries(TABS)) {
    (tabs[field as keyof typeof TABS] || []).forEach((row, i) => {
      for (const [col, v] of Object.entries(row)) {
        if (/^#(N\/A|VALUE!|REF!|DIV\/0!|ERROR!|NAME\?|NUM!|NULL!)/.test(String(v).trim())) bad.push(`${tab} row ${i + 2} "${col}" = ${String(v).trim()}`);
      }
    });
  }
  if (bad.length) warn('sheet', `${bad.length} cell(s) show a spreadsheet error: ${list(bad)}`);

  // Agents: unknown location / tier, shared logins, missing TL
  const personal = new Map<string, string[]>();
  const badMeta: string[] = [];
  const noTl: string[] = [];
  for (const a of tabs.agentsRows) {
    const pick = (...names: string[]) => {
      for (const [k, v] of Object.entries(a)) if (names.map(key).includes(key(k)) && String(v).trim()) return String(v).trim();
      return '';
    };
    const official = normalizeEmail(pick('Agent_Email_Official'));
    if (!official) continue;
    const status = pick('Status').replace(/\s+/g, ' ').trim().toLowerCase();
    if (status && status !== 'active') continue;
    const loc = key(pick('Agent_Location'));
    const tier = key(pick('Agent_Tier'));
    if (!LOCATIONS.includes(loc) || !TIERS.includes(tier)) badMeta.push(`${official} (location "${pick('Agent_Location')}", tier "${pick('Agent_Tier')}")`);
    if (!pick('TL_Official_Email') && !pick('TL_Personal_Email')) noTl.push(official);
    const gmail = normalizeEmail(pick('Agent_Email_Personal'));
    if (gmail && !['none', 'na', 'n/a', '-'].includes(gmail)) personal.set(gmail, [...(personal.get(gmail) || []), official]);
  }
  if (badMeta.length) error('sheet', `Agents with a location or tier the app does not know (they are skipped): ${list(badMeta)}`);
  const shared = [...personal.entries()].filter(([, o]) => o.length > 1).map(([g, o]) => `${g} -> ${o.join(' + ')}`);
  if (shared.length) error('sheet', `The same personal email is used by more than one agent (only one of them can sign in): ${list(shared)}`);
  if (noTl.length) warn('sheet', `Active agents with no TL email (their TL cannot see them): ${list(noTl)}`);

  // Orders: credit date before the order date, zero / negative values
  const early: string[] = [];
  const zero: string[] = [];
  tabs.ordersRows.forEach((o, i) => {
    const get = (...names: string[]) => Object.entries(o).find(([k]) => names.map(key).includes(key(k)))?.[1] ?? '';
    const d = sheetDateTime(get('Date'));
    const c = sheetDateTime(get('Credit_Date', 'Credited_Date'));
    if (d && c && c.day < d.day) early.push(`row ${i + 2} (${get('Order ID')})`);
    const v = Number(String(get('Order Value')).replace(/,/g, '').trim());
    if (!(v > 0)) zero.push(`row ${i + 2} (${get('Order ID')}: "${String(get('Order Value')).trim()}")`);
  });
  if (early.length) warn('sheet', `Orders credited before their order date: ${list(early)}`);
  if (zero.length) warn('sheet', `Orders with a zero, negative or unreadable value: ${list(zero)}`);

  // Dialer Day_Type values
  const oddDay = tabs.dialerRows
    .map((r, i) => ({ i, v: String(Object.entries(r).find(([k]) => key(k) === 'daytype')?.[1] ?? '').trim() }))
    .filter(({ v }) => !['1', '0.5', '0', 'full day', 'half day'].includes(v.toLowerCase()))
    .map(({ i, v }) => `row ${i + 2} "${v}"`);
  if (oddDay.length) warn('sheet', `Dialer Day_Type values other than 1 / 0.5 / Full Day / Half Day: ${list(oddDay)}`);

  // How fresh each tab is
  const latest = (rows: any[], ...cols: string[]) => {
    let max = '';
    for (const r of rows) {
      const v = Object.entries(r).find(([k]) => cols.map(key).includes(key(k)))?.[1];
      const d = sheetDateTime(v)?.day || '';
      if (d > max) max = d;
    }
    return max;
  };
  const fresh = {
    Orders: latest(tabs.ordersRows, 'Credit_Date', 'Credited_Date', 'Date'),
    Visits: latest(tabs.visitsRows, 'Visit Date Time'),
    Dialer: latest(tabs.dialerRows, 'Date'),
    PreSales: latest(tabs.preSalesRows, 'Date'),
  };
  info.push(`Latest date per tab: ${Object.entries(fresh).map(([t, d]) => `${t} ${d || '-'}`).join(', ')}`);
  const newest = Object.values(fresh).sort().pop() || '';
  const behind = Object.entries(fresh).filter(([, d]) => d && newest && d < addDays(newest, -1)).map(([t, d]) => `${t} (${d})`);
  if (behind.length) warn('sheet', `Tabs more than a day behind the newest data (${newest}): ${behind.join(', ')}. Worked days or numbers for the missing days are 0.`);
  if (newest && newest < addDays(todayIst(), -2)) warn('sheet', `The newest data in the sheet is from ${newest}; nothing newer has been added for over 2 days.`);
}

async function appChecks(expected: Map<string, any>, activeAgents: Set<string>, rawCounts: { orders: number; visits: number }) {
  if (!APP_URL) {
    warn('app', 'APP_URL is not set, so the app was not checked.');
    return null;
  }
  const health = await getText(`${APP_URL}/api/health`).catch((e) => ({ status: 0, text: String(e), type: '' }));
  if (health.status !== 200 || !/"status":"ok"/.test(health.text)) error('app', `/api/health failed (HTTP ${health.status}): ${health.text.slice(0, 200)}`);
  if (!MONITOR_KEY) {
    warn('app', 'MONITOR_KEY is not set, so the app data was not compared with the sheet.');
    return null;
  }
  const res = await getText(`${APP_URL}/api/monitor`, { 'X-Monitor-Key': MONITOR_KEY }).catch((e) => ({ status: 0, text: String(e), type: '' }));
  if (res.status !== 200) {
    error('app', `/api/monitor answered HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    return null;
  }
  const mon = JSON.parse(res.text);

  // Sync
  const last = mon.syncLogs?.[0];
  if (!last) error('sync', 'No sync has ever been logged.');
  else {
    info.push(`Last sync: ${last.time} (${last.source}, ${last.result}, ${last.agents ?? 0} agents, data up to ${last.lastDataDate || '-'})`);
    if (last.result !== 'ok') error('sync', `The last sync failed at ${last.time}: ${last.error || (last.warnings || []).join('; ')}`);
    const hours = (Date.now() - Date.parse(last.time)) / 3600000;
    if (hours > 26) error('sync', `The last sync was ${Math.round(hours)} hours ago (${last.time}). The daily trigger may have stopped.`);
  }
  if (mon.raw?.syncStatus && mon.raw.syncStatus.ok === false) error('app', `Raw orders / visits failed to save: ${mon.raw.syncStatus.error}`);

  // Numbers: app vs sheet
  const app = new Map<string, any>((mon.agents || []).filter((a: any) => !a.isTest).map((a: any) => [normalizeEmail(a.officialEmail), a]));
  const missing = [...activeAgents].filter((e) => !app.has(e));
  if (missing.length) warn('compare', `Active agents in the sheet but not in the app (sync not run since they were added, or skipped): ${list(missing)}`);
  const stale = [...app.keys()].filter((e) => !activeAgents.has(e));
  if (stale.length) warn('compare', `Agents in the app who are not active in the Agents tab (old records still shown): ${list(stale)}`);
  const fields: Array<[string, number]> = [['orders', 0.5], ['sales', 1], ['visitsAttributed', 0.5], ['activeDays', 0.01], ['connects', 0.5], ['talkSeconds', 60], ['calls', 0.5]];
  const diffs: string[] = [];
  for (const [email, exp] of expected) {
    const a = app.get(email);
    if (!a) continue;
    const d = fields
      .filter(([f, tol]) => Math.abs((exp[f] ?? 0) - (a.totals?.[f] ?? 0)) > tol)
      .map(([f]) => `${f} sheet ${Math.round((exp[f] ?? 0) * 100) / 100} vs app ${Math.round((a.totals?.[f] ?? 0) * 100) / 100}`);
    if (d.length) diffs.push(`${a.name || email}: ${d.join(', ')}`);
  }
  if (diffs.length) {
    warn('compare', `${diffs.length} agent(s) differ between the sheet and the app. Normal if the sheet was edited after the last sync (${last?.time || 'never'}); otherwise a bug. ${list(diffs, 15)}`);
  }
  if (mon.raw && (mon.raw.ordersCount !== rawCounts.orders || mon.raw.visitsCount !== rawCounts.visits)) {
    warn('compare', `Raw data: the sheet gives ${rawCounts.orders} orders / ${rawCounts.visits} visits, the app holds ${mon.raw.ordersCount} / ${mon.raw.visitsCount} (same note about edits after the last sync).`);
  }
  return mon;
}

async function main() {
  const tabs = await readSheet();
  let cycle = { startDate: process.env.CYCLE_START || '2026-10-01', endDate: process.env.CYCLE_END || '2026-11-30' };
  const expected = new Map<string, any>();
  const active = new Set<string>();
  let rawCounts = { orders: 0, visits: 0 };
  if (tabs) {
    sheetChecks(tabs);
    const built = buildFromCleanSheet(tabs, cycle);
    for (const w of built.warnings) warn('sheet', w);
    const byAgent = new Map<string, any[]>();
    for (const r of built.mainRows) {
      const e = normalizeEmail(r.Agent_Email_Official);
      active.add(e);
      byAgent.set(e, [...(byAgent.get(e) || []), r]);
    }
    for (const [e, rows] of byAgent) expected.set(e, aggregateAgent(rows).totals);
    rawCounts = { orders: built.rawRevenueTabRows.length, visits: built.rawVisitRows.length };
    info.push(`Sheet: ${active.size} active agents, ${rawCounts.orders} orders and ${rawCounts.visits} visits counted for ${cycle.startDate} to ${cycle.endDate}`);
  }
  await appChecks(expected, active, rawCounts);

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  const lines = [
    `# TSC dashboard monitor, ${new Date().toISOString()}`,
    '',
    ...info.map((i) => `- ${i}`),
    '',
    `## Errors (${errors.length})`,
    ...(errors.length ? errors.map((i) => `- [${i.area}] ${i.message}`) : ['- none']),
    '',
    `## Warnings (${warnings.length})`,
    ...(warnings.length ? warnings.map((i) => `- [${i.area}] ${i.message}`) : ['- none']),
    '',
    issues.length ? `STATUS: ISSUES errors=${errors.length} warnings=${warnings.length}` : 'STATUS: OK',
  ];
  const report = lines.join('\n');
  writeFileSync('monitor-report.md', report + '\n');
  console.log(report);
}

main().catch((e) => {
  const msg = `# TSC dashboard monitor\n\nThe monitor script itself crashed: ${e?.stack || e}\n\nSTATUS: ISSUES errors=1 warnings=0`;
  writeFileSync('monitor-report.md', msg + '\n');
  console.log(msg);
  process.exitCode = 2;
});
