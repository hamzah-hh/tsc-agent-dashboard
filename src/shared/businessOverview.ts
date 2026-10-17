/**
 * Business Overview: one row per month and tier. Past months come from the Business_Overview tab of the
 * sheet (typed in once); the months of the active cycle are worked out at every sync from Dialer, Orders and Quality.
 */

export const ALL_TIERS = 'All';

export interface BusinessOverviewRow {
  month: string; // 'YYYY-MM'
  tier: string; // 'HO Caller', 'Store Callers - Andheri', ... or ALL_TIERS
  outbound: number;
  avgOutbound: number | null; // per agent per day
  connected: number;
  avgConnected: number | null;
  talkSec: number;
  avgTalkSec: number | null; // per agent per day
  revenue: number;
  avgRevenue: number | null; // per active agent
  teamSize: number;
  aov: number | null;
  quality: number | null; // 0..1
  qualityPreSales?: number | null; // only on the ALL_TIERS row
  /** True for a month still running (the sync computed it from the cycle's days so far). */
  live?: boolean;
}

/** One agent on one day, as the overview needs it. `tier` is null for Pre Sales (they have no Dialer calls). */
export interface OverviewDay {
  agent: string;
  tier: string | null;
  date: string; // 'YYYY-MM-DD'
  day: number; // worked day value from Dialer (1, 0.5), 0 when none
  outbound: number;
  connected: number;
  talkSec: number;
  sales: number;
  orders: number;
}

export interface OverviewQuality {
  tier: string | null;
  audits: number;
  score: number; // 0..1 or 0..100 as in the Quality tab; normalised below
}

/** Tier name of an agent: 'HO Caller', 'Store Callers - <location>'; null for Pre Sales and unknown tiers. */
export function overviewTier(agentTier: string, location: string): string | null {
  const t = (agentTier || '').toLowerCase();
  if (/pre\s*-?\s*sales/.test(t)) return null;
  if (/store/.test(t)) return `Store Callers - ${(location || '').trim()}`;
  if (/\bho\b|head\s*office/.test(t)) return 'HO Caller';
  return null;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Months of the given days, per tier and for all tiers together. */
export function computeOverview(days: OverviewDay[], quality: OverviewQuality[] = []): BusinessOverviewRow[] {
  type Acc = { outbound: number; connected: number; talkSec: number; agentDays: number; sales: number; orders: number; agents: Set<string> };
  const blank = (): Acc => ({ outbound: 0, connected: 0, talkSec: 0, agentDays: 0, sales: 0, orders: 0, agents: new Set() });
  const acc = new Map<string, Acc>(); // month|tier
  const add = (key: string, d: OverviewDay) => {
    const a = acc.get(key) || blank();
    a.outbound += d.outbound;
    a.connected += d.connected;
    a.talkSec += d.talkSec;
    a.agentDays += d.day;
    a.sales += d.sales;
    a.orders += d.orders;
    if (d.day > 0) a.agents.add(d.agent);
    acc.set(key, a);
  };
  for (const d of days) {
    if (!d.tier) continue;
    const month = d.date.slice(0, 7);
    add(`${month}|${d.tier}`, d);
    add(`${month}|${ALL_TIERS}`, d);
  }

  // Quality is one figure per cycle (the Quality tab has no dates): audit-weighted average per tier
  const q = new Map<string, { audits: number; weighted: number }>();
  const addQ = (tier: string, audits: number, score: number) => {
    const cur = q.get(tier) || { audits: 0, weighted: 0 };
    cur.audits += audits;
    cur.weighted += audits * score;
    q.set(tier, cur);
  };
  for (const item of quality) {
    if (!(item.audits > 0)) continue;
    const score = item.score > 1 ? item.score / 100 : item.score;
    if (item.tier) {
      addQ(item.tier, item.audits, score);
      addQ(ALL_TIERS, item.audits, score);
    } else {
      addQ('pre-sales', item.audits, score);
    }
  }
  const qualityOf = (tier: string) => {
    const c = q.get(tier);
    return c && c.audits > 0 ? c.weighted / c.audits : null;
  };

  const rows: BusinessOverviewRow[] = [];
  for (const [key, a] of acc) {
    const [month, tier] = key.split('|');
    rows.push({
      month,
      tier,
      outbound: a.outbound,
      avgOutbound: div(a.outbound, a.agentDays),
      connected: a.connected,
      avgConnected: div(a.connected, a.agentDays),
      talkSec: Math.round(a.talkSec),
      avgTalkSec: div(a.talkSec, a.agentDays),
      revenue: Math.round(a.sales),
      avgRevenue: div(a.sales, a.agents.size),
      teamSize: a.agents.size,
      aov: div(a.sales, a.orders),
      quality: qualityOf(tier),
      ...(tier === ALL_TIERS ? { qualityPreSales: qualityOf('pre-sales') } : {}),
      live: true,
    });
  }
  return rows.sort((x, y) => x.month.localeCompare(y.month) || x.tier.localeCompare(y.tier));
}

/** History rows win for their months unless the sync computed the month itself. */
export function mergeOverview(history: BusinessOverviewRow[], live: BusinessOverviewRow[]): BusinessOverviewRow[] {
  const byKey = new Map<string, BusinessOverviewRow>();
  for (const r of history) byKey.set(`${r.month}|${r.tier}`, r);
  for (const r of live) byKey.set(`${r.month}|${r.tier}`, r);
  return [...byKey.values()].sort((x, y) => x.month.localeCompare(y.month) || x.tier.localeCompare(y.tier));
}
