import { adminDb } from './server-firebase-admin';
import { normalizeEmail } from './src/shared/incentive';
import {
  RawOrderRecord,
  RawVisitRecord,
  LocationRevenueData,
  LocationRevenueAgentRow,
  AgentRecord,
} from './src/shared/types';

export const DEFAULT_RAW_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1Bg_F0Asq16F1BSwxyKF7SjFH4UUSVk6cTZ6cp9dnqb0/edit';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string) => {
    const res: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    rows.push(obj);
  }
  return rows;
}

/** Header key with case, spaces and punctuation removed: " Order Value " and "order_value" both -> "ordervalue". */
function headerKey(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reads a column by any of its known header names, ignoring case, spacing and punctuation, and returns it
 * as a trimmed string. Sheet values sent by Apps Script can be numbers or booleans, not only strings, so
 * every value is converted with String() before any string method is used on it.
 */
function pick(row: Record<string, any>, ...names: string[]): string {
  const wanted = new Set(names.map(headerKey));
  for (const [k, v] of Object.entries(row || {})) {
    if (wanted.has(headerKey(k)) && v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return '';
}

const ORDER_VALUE_HEADERS = ['Order Value', 'order_value', 'Order_Value'];
const ORDER_AGENT_HEADERS = ['Agent', 'Agent Email', 'Agent_Email'];
const VISIT_AGENT_HEADERS = ['Agent ID', 'agent_id', 'Agent', 'Agent Email'];

/** Branch from a sheet's location / agent-category text. */
function branchOf(text: string, fallback: string): string {
  const t = text.toLowerCase();
  if (t.includes('andheri')) return 'Andheri';
  if (t.includes('bangalore') || t.includes('bengaluru')) return 'Bangalore';
  if (t.includes('dighe') || /\bho\b/.test(t)) return 'Dighe';
  return fallback;
}

export function normalizeRawOrders(rawOrders: any[], excludedSet: Set<string>): RawOrderRecord[] {
  return (rawOrders || []).map((o) => {
    const agentCategory = pick(o, 'Agent Category');
    const val = parseFloat(pick(o, ...ORDER_VALUE_HEADERS).replace(/[^0-9.-]/g, '')) || 0;
    return {
      orderId: pick(o, 'Order ID', 'order_id', 'Order_ID'),
      date: pick(o, 'Date', 'Activity Date/Order Date'),
      orderTime: pick(o, 'Order Time', 'order_time', 'Order_Time'),
      orderValue: Math.round(val),
      orderPhone: pick(o, 'Phone/Alternate Phone', 'Order Phone / Alternate Phone', 'Order_Phone', 'phone_alternate_phone'),
      agentEmail: normalizeEmail(pick(o, ...ORDER_AGENT_HEADERS)),
      category: pick(o, 'Category'),
      talkTimeCohort: pick(o, 'Talk Time Cohort'),
      originalPhoneOrMarketplace: pick(
        o,
        'Original Phone/Marketplace Name',
        'Original Phone / Marketplace Name (for Alt/MP Orders)'
      ),
      consideredForOverall: true,
      consideredForAgent: true,
      agentCategory,
      location: branchOf(agentCategory || pick(o, 'Location'), 'Dighe'),
      channel: pick(o, 'Channel'),
    };
  }).filter((o) => !excludedSet.has(normalizeEmail(o.agentEmail)));
}

export function normalizeRawVisits(rawVisits: any[], excludedSet: Set<string>): RawVisitRecord[] {
  return (rawVisits || []).map((v, i) => {
    const visitDateTime = pick(v, 'Visit Date Time', 'visit_date_time');
    return {
      id: 'visit_' + (i + 1),
      type: 'STORE' as const,
      date: (visitDateTime || pick(v, 'Date')).split(' ')[0] || '',
      visitDateTime,
      phoneNumber: pick(v, 'Phone Number', 'phone_number'),
      agentEmail: normalizeEmail(pick(v, ...VISIT_AGENT_HEADERS)),
      location: branchOf(pick(v, 'Location'), 'Store'),
      talkTimeSeconds: parseInt(pick(v, 'Talk Time (before visit)', 'Talk Time before visit', 'talk_time_before_visit'), 10) || 0,
      visitSource: pick(v, 'Visit Source', 'visit_source'),
    };
  }).filter((v) => !excludedSet.has(normalizeEmail(v.agentEmail)));
}

/**
 * Throws when a raw tab has rows but not the columns the app needs, naming the headers it did find
 * (header names only, never cell values). Without this a renamed or missing header row silently
 * produced orders with no value and no agent.
 */
export function assertRawHeaders(tab: 'Raw_Revenue' | 'Raw_Visit', rows: any[]): void {
  if (!rows || rows.length === 0) return;
  const keys = new Set<string>();
  for (const r of rows.slice(0, 5)) Object.keys(r || {}).forEach((k) => keys.add(headerKey(k)));
  const groups: Record<string, string[]> =
    tab === 'Raw_Revenue' ? { 'Order Value': ORDER_VALUE_HEADERS, Agent: ORDER_AGENT_HEADERS } : { 'Agent ID': VISIT_AGENT_HEADERS };
  const missing = Object.entries(groups)
    .filter(([, names]) => !names.some((n) => keys.has(headerKey(n))))
    .map(([label]) => label);
  if (missing.length > 0) {
    const found = Object.keys(rows[0] || {}).filter((k) => k.trim() !== '').slice(0, 12);
    throw new Error(
      `${tab}: missing column ${missing.join(', ')}. Row 1 of the tab must be the header row. ` +
        `Columns found: ${found.length ? found.map((f) => `"${f}"`).join(', ') : '(none)'}`
    );
  }
}

export function buildLocationSummaries(orders: RawOrderRecord[]): Record<string, LocationRevenueData> {
  const locationSummaries: Record<string, LocationRevenueData> = {};
  const locations = ['Dighe', 'Andheri', 'Bangalore'];

  for (const loc of locations) {
    const locOrders = orders.filter((o) => o.location.toLowerCase() === loc.toLowerCase());
    const agentMap = new Map<string, LocationRevenueAgentRow>();

    let totalOrders = 0;
    let totalRevenue = 0;
    let shopifyOrders = 0;
    let shopifyRevenue = 0;
    let altOrders = 0;
    let altRevenue = 0;
    let mpOrders = 0;
    let mpRevenue = 0;
    let posOrders = 0;
    let posRevenue = 0;

    for (const o of locOrders) {
      totalOrders++;
      totalRevenue += o.orderValue;

      const email = normalizeEmail(o.agentEmail);
      if (!agentMap.has(email)) {
        agentMap.set(email, {
          agentEmail: email,
          shopifyOrders: 0,
          shopifyRevenue: 0,
          altOrders: 0,
          altRevenue: 0,
          mpOrders: 0,
          mpRevenue: 0,
          posOrders: 0,
          posRevenue: 0,
          totalOrders: 0,
          totalRevenue: 0,
          aov: 0,
        });
      }
      const ag = agentMap.get(email)!;
      ag.totalOrders++;
      ag.totalRevenue += o.orderValue;

      const cat = o.category.toLowerCase();
      if (cat.includes('shopify')) {
        shopifyOrders++;
        shopifyRevenue += o.orderValue;
        ag.shopifyOrders++;
        ag.shopifyRevenue += o.orderValue;
      } else if (cat.includes('another number') || cat.includes('alt')) {
        altOrders++;
        altRevenue += o.orderValue;
        ag.altOrders++;
        ag.altRevenue += o.orderValue;
      } else if (cat.includes('marketplace')) {
        mpOrders++;
        mpRevenue += o.orderValue;
        ag.mpOrders++;
        ag.mpRevenue += o.orderValue;
      } else if (cat.includes('pos')) {
        posOrders++;
        posRevenue += o.orderValue;
        ag.posOrders++;
        ag.posRevenue += o.orderValue;
      }
    }

    const rows = Array.from(agentMap.values()).map((r) => ({
      ...r,
      aov: r.totalOrders > 0 ? Math.round(r.totalRevenue / r.totalOrders) : 0,
    }));
    rows.sort((a, b) => b.totalRevenue - a.totalRevenue);

    locationSummaries[loc] = {
      location: loc,
      totalOrders,
      totalRevenue,
      aov: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      categories: {
        shopify: { orders: shopifyOrders, sales: shopifyRevenue },
        bfan: { orders: altOrders, sales: altRevenue },
        bfmp: { orders: mpOrders, sales: mpRevenue },
        posoc: { orders: posOrders, sales: posRevenue },
      },
      rows,
    };
  }
  return locationSummaries;
}

function rawRecordsRef(cycleId: string) {
  return adminDb.collection('cycles').doc(cycleId).collection('data').doc('rawRecords');
}

function rawStatusRef(cycleId: string) {
  return adminDb.collection('cycles').doc(cycleId).collection('data').doc('rawRecordsStatus');
}

/** Outcome of the last attempt to fill rawRecords, shown in the Raw Data view and the sync result. */
export interface RawSyncStatus {
  ok: boolean;
  at: string;
  source: 'sync-payload' | 'sheet-csv';
  ordersCount?: number;
  visitsCount?: number;
  error?: string;
}

/** After a failed attempt, page views wait this long before fetching the sheet again. */
export const RAW_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

export async function recordRawSyncStatus(cycleId: string, status: RawSyncStatus): Promise<void> {
  invalidateRawCache();
  try {
    await rawStatusRef(cycleId).set(status);
  } catch (e) {
    console.error('[RawData] Could not save the raw-data sync status:', e);
  }
}

export async function getRawSyncStatus(cycleId: string): Promise<RawSyncStatus | null> {
  try {
    const snap = await rawStatusRef(cycleId).get();
    return snap.exists ? (snap.data() as RawSyncStatus) : null;
  } catch (_e) {
    return null;
  }
}

// A Firestore document holds at most 1 MiB, and a cycle has more orders than that. So rawRecords keeps
// only the summary and chunk counts, and the rows live in rawRecords/chunks/orders-0, orders-1, ...
// (about 400 bytes a row, so a chunk stays near 0.4 MiB). Older data with the rows inline still reads.
const RAW_CHUNK_SIZE = 1000;

function rawChunksCol(cycleId: string) {
  return rawRecordsRef(cycleId).collection('chunks');
}

function chunk<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += RAW_CHUNK_SIZE) out.push(rows.slice(i, i + RAW_CHUNK_SIZE));
  return out;
}

// The raw rows are read on every Raw Data, Day-on-Day and Location Revenue page view. Cached per server
// instance for a short time; any save on this instance drops the cache.
const RAW_CACHE_TTL_MS = 30000;
const rawCache = new Map<string, { at: number; value: RawRecordsDoc }>();

export function invalidateRawCache(): void {
  rawCache.clear();
}

export async function saveRawRecords(cycleId: string, orders: RawOrderRecord[], visits: RawVisitRecord[]) {
  const locationSummaries = buildLocationSummaries(orders);
  const prev = await rawRecordsRef(cycleId).get();
  const prevData = prev.exists ? (prev.data() as any) : null;
  const orderChunks = chunk(orders);
  const visitChunks = chunk(visits);

  // One atomic commit when it fits (400 writes = 400,000 rows): readers never see half a save
  const batch = adminDb.batch();
  orderChunks.forEach((rows, i) => batch.set(rawChunksCol(cycleId).doc(`orders-${i}`), { rows }));
  visitChunks.forEach((rows, i) => batch.set(rawChunksCol(cycleId).doc(`visits-${i}`), { rows }));
  for (let i = orderChunks.length; i < (prevData?.orderChunks || 0); i++) batch.delete(rawChunksCol(cycleId).doc(`orders-${i}`));
  for (let i = visitChunks.length; i < (prevData?.visitChunks || 0); i++) batch.delete(rawChunksCol(cycleId).doc(`visits-${i}`));
  batch.set(rawRecordsRef(cycleId), {
    orderChunks: orderChunks.length,
    visitChunks: visitChunks.length,
    ordersCount: orders.length,
    visitsCount: visits.length,
    locationSummaries,
    updatedAt: new Date().toISOString(),
  });
  await batch.commit();
  invalidateRawCache();
}

/** The saved raw data, from chunks or (older saves) inline. null when nothing is saved. */
async function readRawRecords(cycleId: string): Promise<Omit<RawRecordsDoc, 'syncStatus'> | null> {
  const snap = await rawRecordsRef(cycleId).get();
  if (!snap.exists) return null;
  const d = snap.data() as any;
  if (Array.isArray(d.orders) || Array.isArray(d.visits)) {
    return { orders: d.orders || [], visits: d.visits || [], locationSummaries: d.locationSummaries, updatedAt: d.updatedAt };
  }
  const read = async (prefix: string, count: number) => {
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => rawChunksCol(cycleId).doc(`${prefix}-${i}`).get())
    );
    return parts.flatMap((p) => (p.exists ? (p.data() as any)?.rows || [] : []));
  };
  const [orders, visits] = await Promise.all([read('orders', d.orderChunks || 0), read('visits', d.visitChunks || 0)]);
  return { orders, visits, locationSummaries: d.locationSummaries, updatedAt: d.updatedAt };
}

/**
 * Normalizes, checks and saves raw rows that arrived in the Apps Script sync payload, and records the
 * outcome. Throws with the reason on failure (the caller reports it as a sync warning).
 */
export async function saveRawPayload(
  cycleId: string,
  rawRevenueTabRows: any[],
  rawVisitRows: any[],
  excludedSet: Set<string>
): Promise<{ ordersCount: number; visitsCount: number }> {
  try {
    assertRawHeaders('Raw_Revenue', rawRevenueTabRows);
    assertRawHeaders('Raw_Visit', rawVisitRows);
    const orders = normalizeRawOrders(rawRevenueTabRows, excludedSet);
    const visits = normalizeRawVisits(rawVisitRows, excludedSet);
    await saveRawRecords(cycleId, orders, visits);
    const result = { ordersCount: orders.length, visitsCount: visits.length };
    await recordRawSyncStatus(cycleId, { ok: true, at: new Date().toISOString(), source: 'sync-payload', ...result });
    return result;
  } catch (err: any) {
    const error = err?.message || String(err);
    await recordRawSyncStatus(cycleId, { ok: false, at: new Date().toISOString(), source: 'sync-payload', error });
    throw new Error(error);
  }
}

/**
 * Downloads one tab as CSV through the sheet's public CSV export. This only works while the sheet is
 * shared as "Anyone with the link can view"; otherwise Google answers with a sign-in page (HTML), which
 * used to be parsed as if it were data. Now anything that is not CSV is an error with the reason.
 */
let sheetFetch: typeof fetch = (input, init) => fetch(input, init);

/** Tests replace the Google Sheets download so they never touch the network or the real sheet. */
export function setRawSheetFetchForTests(f: typeof fetch | null): void {
  sheetFetch = f || ((input, init) => fetch(input, init));
}

async function fetchTabCsv(spreadsheetId: string, tab: string): Promise<Record<string, string>[]> {
  // headers=1: always treat row 1 as the header row (otherwise Google guesses, and can guess 0).
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
  let res: Response;
  try {
    res = await sheetFetch(url);
  } catch (err: any) {
    throw new Error(`${tab}: could not reach Google Sheets (${err?.message || err})`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    throw new Error(`${tab}: Google Sheets answered HTTP ${res.status}. Check the tab name and that the sheet is shared as "Anyone with the link can view".`);
  }
  if (!/csv|text\/plain/i.test(contentType)) {
    throw new Error(`${tab}: Google Sheets did not return CSV (got "${contentType || 'unknown'}"). The sheet is probably not shared as "Anyone with the link can view".`);
  }
  return parseCSV(await res.text());
}

/** The spreadsheet id in a Google Sheets URL. */
export function spreadsheetIdOf(sheetUrl?: string): string | null {
  const match = (sheetUrl || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Ingests the 2 raw tabs from the Google Sheet:
 * - Raw_Revenue (orders)
 * - Raw_Visit (visits)
 * Throws with the reason on any failure, and records the outcome in rawRecordsStatus. Existing raw
 * records are only replaced after both tabs were read and checked.
 */
export async function syncRawSheetData(cycleId: string, sheetUrl = DEFAULT_RAW_SHEET_URL) {
  try {
    // Load excluded agents
    const excludedSet = new Set<string>();
    try {
      const excludesSnap = await adminDb.collection('cycles').doc(cycleId).collection('data').doc('excludedAgents').get();
      if (excludesSnap.exists) {
        const list = excludesSnap.data()?.list || [];
        for (const item of list) {
          if (item.active && item.agentEmail) {
            excludedSet.add(normalizeEmail(item.agentEmail));
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load excluded agents in syncRawSheetData:', e);
    }

    const spreadsheetId = spreadsheetIdOf(sheetUrl);
    if (!spreadsheetId) throw new Error(`Not a Google Sheets URL: "${sheetUrl}"`);

    const [rawOrders, rawVisits] = await Promise.all([
      fetchTabCsv(spreadsheetId, 'Raw_Revenue'),
      fetchTabCsv(spreadsheetId, 'Raw_Visit'),
    ]);
    assertRawHeaders('Raw_Revenue', rawOrders);
    assertRawHeaders('Raw_Visit', rawVisits);

    const orders = normalizeRawOrders(rawOrders, excludedSet);
    const visits = normalizeRawVisits(rawVisits, excludedSet);
    await saveRawRecords(cycleId, orders, visits);

    const result = { ordersCount: orders.length, visitsCount: visits.length };
    await recordRawSyncStatus(cycleId, { ok: true, at: new Date().toISOString(), source: 'sheet-csv', ...result });
    return result;
  } catch (err: any) {
    const error = err?.message || String(err);
    console.error('[RawData] Raw sheet sync failed:', error);
    await recordRawSyncStatus(cycleId, { ok: false, at: new Date().toISOString(), source: 'sheet-csv', error });
    throw new Error(error);
  }
}

export interface RawRecordsDoc {
  orders: RawOrderRecord[];
  visits: RawVisitRecord[];
  locationSummaries?: Record<string, LocationRevenueData>;
  updatedAt?: string;
  /** The last fill attempt, so screens can say why the data is missing instead of showing zeros. */
  syncStatus?: RawSyncStatus | null;
}

/**
 * Loads the saved raw data. When nothing is saved yet it tries to fetch the sheet once; after a failed
 * attempt it waits RAW_RETRY_COOLDOWN_MS before trying again, instead of re-downloading on every page
 * view. Never throws for a fetch problem: it returns empty data plus the reason in syncStatus.
 */
export async function getOrLoadRawRecords(cycleId: string): Promise<RawRecordsDoc> {
  const hit = rawCache.get(cycleId);
  if (hit && Date.now() - hit.at < RAW_CACHE_TTL_MS) return structuredClone(hit.value);
  const value = await getOrLoadRawRecordsUncached(cycleId);
  rawCache.set(cycleId, { at: Date.now(), value: structuredClone(value) });
  return value;
}

async function getOrLoadRawRecordsUncached(cycleId: string): Promise<RawRecordsDoc> {
  const saved = await readRawRecords(cycleId);
  const status = await getRawSyncStatus(cycleId);
  if (saved && (saved.orders.length > 0 || saved.visits.length > 0)) {
    return { ...saved, syncStatus: status };
  }

  const empty: RawRecordsDoc = { orders: [], visits: [], locationSummaries: {}, syncStatus: status };
  if (status && !status.ok && Date.now() - new Date(status.at).getTime() < RAW_RETRY_COOLDOWN_MS) {
    return empty;
  }

  // Load appConfig to get the correct spreadsheet URL
  let sheetUrl: string | undefined;
  try {
    const configSnap = await adminDb.collection('config').doc('app').get();
    if (configSnap.exists) {
      sheetUrl = configSnap.data()?.googleSpreadsheetUrl;
    }
  } catch (err) {
    console.warn('Failed to load config for spreadsheetUrl in getOrLoadRawRecords:', err);
  }

  try {
    await syncRawSheetData(cycleId, sheetUrl || DEFAULT_RAW_SHEET_URL);
  } catch (_err) {
    // syncRawSheetData already recorded the reason in rawRecordsStatus.
    return { ...empty, syncStatus: await getRawSyncStatus(cycleId) };
  }
  const fresh = await readRawRecords(cycleId);
  return {
    orders: fresh?.orders || [],
    visits: fresh?.visits || [],
    locationSummaries: fresh?.locationSummaries || {},
    updatedAt: fresh?.updatedAt,
    syncStatus: await getRawSyncStatus(cycleId),
  };
}
