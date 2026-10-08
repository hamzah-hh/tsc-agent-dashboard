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

/**
 * Ranked rows for one location's leaderboard.
 *
 * - For Pre Sales (Dighe Pre Sales): agents are ranked by Total Incentive, then average calls per day,
 *   then talk time seconds, then name A-Z.
 * - For Revenue branches (Dighe, Andheri, Bangalore): agents are ranked by Total Incentive, then achievement %,
 *   then name A-Z.
 * - Demo / test agents only rank while test mode is on.
 */
export function buildLocationRows(
  agents: AgentRecord[],
  location: string,
  includeTest: boolean
): LeaderboardRow[] {
  const isPreSalesLoc = location.toLowerCase().includes('pre sales');

  if (isPreSalesLoc) {
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
    .sort(
      (a, b) =>
        ((b.totals?.sales ?? 0) - (a.totals?.sales ?? 0)) ||
        a.name.localeCompare(b.name)
    )
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
