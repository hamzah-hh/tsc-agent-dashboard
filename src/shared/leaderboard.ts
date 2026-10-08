import { AgentRecord, LeaderboardRow } from './types';

/**
 * Checks whether an agent is a test/demo dummy agent by email or name.
 */
export function isTestAgentIdentifier(email?: string, name?: string): boolean {
  const e = (email || '').trim().toLowerCase();
  const n = (name || '').trim().toLowerCase();
  return (
    e === 'test@thesleepcompany.in' ||
    e === 'test.agent@tsc.com' ||
    e === 'tl@tsc.com' ||
    e.startsWith('test.') ||
    e.startsWith('test@') ||
    n === 'testemp' ||
    n === 'test agent' ||
    n.startsWith('test agent') ||
    n.startsWith('demo agent')
  );
}

/** True for the Pre Sales leaderboard (e.g. "Dighe (Pre Sales)"), which is not revenue-ranked. */
export function isPreSalesLocation(location: string): boolean {
  return (location || '').toLowerCase().includes('pre sales');
}

/**
 * Revenue ranking used by every revenue leaderboard (Dighe, Andheri, Bangalore): highest revenue first,
 * then name A-Z. The incentive payout is deliberately NOT part of the order: it is bucketed by class, so
 * an agent with the highest revenue could otherwise rank below agents who earned a bigger bucket.
 */
export function compareByRevenue(a: { sales: number; name: string }, b: { sales: number; name: string }): number {
  return (b.sales || 0) - (a.sales || 0) || (a.name || '').localeCompare(b.name || '');
}

/**
 * Re-sorts and re-ranks stored revenue-leaderboard rows by revenue. Leaderboard documents are written at
 * sync time, so documents saved by older code can still be in incentive order; serving them through this
 * makes the order correct at once, without waiting for the next sync. Pre Sales rows are returned as is.
 */
export function rankRevenueRows<T extends { rank: number; sales: number; name: string }>(
  rows: T[],
  location: string
): T[] {
  if (isPreSalesLocation(location)) return rows;
  return [...rows].sort(compareByRevenue).map((r, index) => ({ ...r, rank: index + 1 }));
}

/**
 * Ranked rows for one location's leaderboard.
 *
 * - For Pre Sales (Dighe Pre Sales): agents are ranked by Total Incentive, then average calls per day,
 *   then talk time seconds, then name A-Z.
 * - For Revenue branches (Dighe, Andheri, Bangalore): agents are ranked by Revenue (totals.sales),
 *   highest first, then name A-Z (see compareByRevenue). The incentive amount does not affect the order.
 * - Demo / test agents only rank while test mode is on.
 */
export function buildLocationRows(
  agents: AgentRecord[],
  location: string,
  includeTest: boolean
): LeaderboardRow[] {
  if (isPreSalesLocation(location)) {
    return agents
      .filter(
        (a) =>
          a.agentType === 'PRE_SALES' &&
          (includeTest || (!a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name)))
      )
      .sort(
        (a, b) =>
          ((b.result?.total ?? 0) - (a.result?.total ?? 0)) ||
          ((b.result?.preSales?.calls.value ?? 0) - (a.result?.preSales?.calls.value ?? 0)) ||
          ((b.result?.preSales?.talk.value ?? 0) - (a.result?.preSales?.talk.value ?? 0)) ||
          a.name.localeCompare(b.name)
      )
      .map((a, index) => ({
        rank: index + 1,
        name: a.name,
        officialEmail: a.officialEmail,
        sales: 0,
        achievementPct: 0,
        className: 'PS',
        totalIncentive: a.result?.total ?? 0,
        agentType: 'PRE_SALES',
        avgCalls: a.result?.preSales?.calls.value ?? (a.totals?.activeDays ? Math.round((a.totals.calls || 0) / a.totals.activeDays) : 0),
        avgTalkSeconds: a.result?.preSales?.talk.value ?? 0,
        qualityScore: a.quality?.audits ? a.quality.score : null,
        callsTier: a.result?.preSales?.calls.tier ?? 0,
        talkTier: a.result?.preSales?.talk.tier ?? 0,
      }));
  }

  // HO Callers: strictly Dighe HO callers
  // Store Callers: strictly Andheri & Bangalore store callers
  const isHOLoc = location.toLowerCase() === 'dighe';
  const expectedAgentType = isHOLoc ? 'HO' : 'STORE';

  return agents
    .filter(
      (a) =>
        a.agentType === expectedAgentType &&
        a.location.toLowerCase() === location.toLowerCase() &&
        (includeTest || (!a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name)))
    )
    .sort((a, b) => compareByRevenue({ sales: a.totals?.sales ?? 0, name: a.name }, { sales: b.totals?.sales ?? 0, name: b.name }))
    .map((a, index) => ({
      rank: index + 1,
      name: a.name,
      officialEmail: a.officialEmail,
      sales: a.totals?.sales ?? 0,
      achievementPct: a.result?.achievementPct ?? 0,
      className: a.result?.className ?? 'NQ',
      totalIncentive: a.result?.total ?? 0,
      agentType: a.agentType,
    }));
}
