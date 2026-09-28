import { AgentRecord, LeaderboardRow } from './types';

/**
 * Ranked rows for one location's leaderboard: Total Incentive, then achievement %, then name A-Z.
 *
 * - Pre Sales agents are not ranked here: they have no revenue or class, so they would sit at the
 *   bottom of a revenue leaderboard. They still appear in the Team view.
 * - Demo / test agents only rank while test mode is on, so they never sit next to real agents once
 *   the app is live.
 */
export function buildLocationRows(
  agents: AgentRecord[],
  location: string,
  includeTest: boolean
): LeaderboardRow[] {
  return agents
    .filter(
      (a) =>
        a.location === location &&
        a.agentType !== 'PRE_SALES' &&
        (includeTest || !a.isTest)
    )
    .sort(
      (a, b) =>
        b.result.total - a.result.total ||
        b.result.achievementPct - a.result.achievementPct ||
        a.name.localeCompare(b.name)
    )
    .map((a, index) => ({
      rank: index + 1,
      name: a.name,
      officialEmail: a.officialEmail,
      sales: a.totals.sales,
      achievementPct: a.result.achievementPct,
      className: a.result.className,
      totalIncentive: a.result.total,
    }));
}
