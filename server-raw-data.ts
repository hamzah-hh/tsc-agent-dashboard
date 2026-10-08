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

export function normalizeRawOrders(rawOrders: any[], excludedSet: Set<string>): RawOrderRecord[] {
  return rawOrders.map((o) => {
    let loc = o['Agent Category'] || o['Location'] || '';
    if (loc.includes('Andheri')) loc = 'Andheri';
    else if (loc.includes('Bangalore')) loc = 'Bangalore';
    else if (loc.includes('HO') || loc.includes('Dighe')) loc = 'Dighe';
    else loc = 'Dighe';

    const val = parseFloat((o['Order Value'] || o['order_value'] || o['Order_Value'] || '0').replace(/[^0-9.-]/g, '')) || 0;
    return {
      orderId: String(o['Order ID'] || o['order_id'] || o['Order_ID'] || ''),
      date: String(o['Date'] || o['date'] || ''),
      orderTime: String(o['Order Time'] || o['order_time'] || o['Order_Time'] || ''),
      orderValue: Math.round(val),
      orderPhone: String(o['Phone/Alternate Phone'] || o['phone_alternate_phone'] || o['Phone / Alternate Phone'] || o['Order Phone / Alternate Phone'] || o['Order_Phone'] || ''),
      agentEmail: normalizeEmail(o['Agent'] || o['agent'] || ''),
      category: String(o['Category'] || o['category'] || ''),
      talkTimeCohort: String(o['Talk Time Cohort'] || o['talk_time_cohort'] || ''),
      originalPhoneOrMarketplace: String(o['Original Phone/Marketplace Name'] || o['Original Phone / Marketplace Name (for Alt/MP Orders)'] || ''),
      consideredForOverall: true,
      consideredForAgent: true,
      agentCategory: String(o['Agent Category'] || ''),
      location: loc,
      channel: String(o['Channel'] || o['channel'] || ''),
    };
  }).filter((o) => !excludedSet.has(normalizeEmail(o.agentEmail)));
}

export function normalizeRawVisits(rawVisits: any[], excludedSet: Set<string>): RawVisitRecord[] {
  return rawVisits.map((v, i) => {
    let loc = v['Location'] || v['location'] || '';
    if (loc.includes('Andheri')) loc = 'Andheri';
    else if (loc.includes('Bangalore')) loc = 'Bangalore';
    else if (loc.includes('Dighe')) loc = 'Dighe';
    else loc = 'Store';
    
    return {
      id: 'visit_' + (i + 1),
      type: 'STORE' as const,
      date: String((v['Visit Date Time'] || v['visit_date_time'] || v['Date'] || v['date'] || '').split(' ')[0] || ''),
      visitDateTime: String(v['Visit Date Time'] || v['visit_date_time'] || ''),
      phoneNumber: String(v['Phone Number'] || v['phone_number'] || ''),
      agentEmail: normalizeEmail(v['Agent ID'] || v['agent_id'] || v['Agent'] || ''),
      location: loc,
      talkTimeSeconds: parseInt(v['Talk Time (before visit)'] || v['talk_time_before_visit'] || '0', 10) || 0,
      visitSource: String(v['Visit Source'] || v['visit_source'] || ''),
    };
  }).filter((v) => !excludedSet.has(normalizeEmail(v.agentEmail)));
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

export async function saveRawRecords(cycleId: string, orders: RawOrderRecord[], visits: RawVisitRecord[]) {
  const locationSummaries = buildLocationSummaries(orders);
  const dataRef = adminDb.collection('cycles').doc(cycleId).collection('data').doc('rawRecords');
  await dataRef.set({
    orders,
    visits,
    locationSummaries,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Ingests the 2 raw tabs from the Google Sheet:
 * - Raw_Revenue (orders)
 * - Raw_Visit (visits)
 */
export async function syncRawSheetData(cycleId: string, sheetUrl = DEFAULT_RAW_SHEET_URL) {
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

  // Extract spreadsheet ID from sheetUrl
  const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = match ? match[1] : '1Bg_F0Asq16F1BSwxyKF7SjFH4UUSVk6cTZ6cp9dnqb0';
  const urlBase = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=`;

  const [ordersRes, visitsRes] = await Promise.all([
    fetch(urlBase + 'Raw_Revenue'),
    fetch(urlBase + 'Raw_Visit'),
  ]);

  const [ordersCsv, visitsCsv] = await Promise.all([
    ordersRes.text(),
    visitsRes.text(),
  ]);

  const rawOrders = parseCSV(ordersCsv);
  const rawVisits = parseCSV(visitsCsv);

  // Normalize Orders
  const orders = normalizeRawOrders(rawOrders, excludedSet);

  // Normalize Visits
  const visits = normalizeRawVisits(rawVisits, excludedSet);

  // Save raw records
  await saveRawRecords(cycleId, orders, visits);

  return { ordersCount: orders.length, visitsCount: visits.length };
}

/**
 * Loads cached raw data or fetches and populates if not yet present.
 */
export async function getOrLoadRawRecords(cycleId: string) {
  const dataRef = adminDb.collection('cycles').doc(cycleId).collection('data').doc('rawRecords');
  const snap = await dataRef.get();
  if (snap.exists) {
    const d = snap.data() as any;
    if (Array.isArray(d.orders) && d.orders.length > 0) {
      return d as {
        orders: RawOrderRecord[];
        visits: RawVisitRecord[];
        locationSummaries?: Record<string, LocationRevenueData>;
        updatedAt?: string;
      };
    }
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

  // If not yet seeded or empty, automatically fetch and populate
  await syncRawSheetData(cycleId, sheetUrl);
  const freshSnap = await dataRef.get();
  return freshSnap.data() as {
    orders: RawOrderRecord[];
    visits: RawVisitRecord[];
    locationSummaries?: Record<string, LocationRevenueData>;
    updatedAt?: string;
  };
}
