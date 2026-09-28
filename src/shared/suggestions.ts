import { AgentRecord, Cycle, Plan, PreSalesPlan, Suggestion } from './types';
import {
  calculateFromMetrics,
  calculatePreSales,
  formatCurrencyINR,
  formatNumberINR,
  metricsFromTotals,
  pickPreSalesTier,
  preSalesMetricsFromTotals,
} from './incentive';
import {
  calculateRemainingWorkingDays,
  minSalesForClass,
  requiredPerDay,
  calculateProjection,
} from './planning';
import { getPreSalesPlan, getRevenuePlan } from './plans';

/**
 * Pure function: buildSuggestions(agentRecord, plan, cycle) returns Suggestion[]
 *
 * Types:
 * 1. nextClass
 * 2. ordersNeeded
 * 3. fastestBonus
 * 4. storeVisits
 * 5. projection
 * 6. warning (priority highest)
 * 7. streak
 * 8. milestone
 * 9. headline
 *
 * Sort: warnings first, then by gainRupees descending.
 * Show max 5 items plus 1 headline.
 */
export function buildSuggestions(
  agentRecord: AgentRecord | null | undefined,
  plan: Plan,
  cycle: Cycle
): Suggestion[] {
  if (!agentRecord || !agentRecord.totals || agentRecord.totals.activeDays <= 0) {
    return [];
  }

  const { totals, quality, absentDays, daily, lastDataDate, result } = agentRecord;
  const currentTotal = result.total;
  const activeDays = totals.activeDays;
  const currentSales = totals.sales;
  const remainingWorkingDays = calculateRemainingWorkingDays(
    lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );

  const currentDailyAvgSales = activeDays > 0 ? currentSales / activeDays : 0;
  const currentMetrics = metricsFromTotals(totals, quality, absentDays);

  const suggestions: Suggestion[] = [];

  // Helper to calculate gain if metrics change
  function testGain(metricsDelta: Partial<typeof currentMetrics>): number {
    const updatedMetrics = { ...currentMetrics, ...metricsDelta };
    const simulatedResult = calculateFromMetrics(updatedMetrics, plan);
    return Math.max(0, simulatedResult.total - currentTotal);
  }

  // --- 9. HEADLINE ---
  // "Day <X> of <Y>: you are at <Z>% of target."
  // X = calendar days elapsed or active days. Standard specification:
  // Day X of Y: total days in cycle vs current elapsed day
  const startMs = new Date(cycle.startDate + 'T00:00:00Z').getTime();
  const endMs = new Date(cycle.endDate + 'T00:00:00Z').getTime();
  const totalCycleCalendarDays = Math.max(
    1,
    Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1
  );
  const lastDataMs = lastDataDate
    ? new Date(lastDataDate + 'T00:00:00Z').getTime()
    : startMs;
  const elapsedDays = Math.max(
    1,
    Math.min(
      totalCycleCalendarDays,
      Math.round((lastDataMs - startMs) / (1000 * 60 * 60 * 24)) + 1
    )
  );

  const headlineSuggestion: Suggestion = {
    id: 'headline',
    type: 'headline',
    priority: 100,
    gainRupees: 0,
    numbers: {
      day: elapsedDays,
      totalDays: totalCycleCalendarDays,
      achievementPct: result.achievementPct,
    },
    defaultText: `Day ${elapsedDays} of ${totalCycleCalendarDays}: you are at ${formatNumberINR(
      result.achievementPct,
      1
    )}% of target.`,
    difficult: false,
  };

  // --- 1. NEXT CLASS & 2. ORDERS NEEDED ---
  // Find current class index in plan.classes
  const currentClassIdx = plan.classes.findIndex((c) => c.name === result.className);
  // If not at highest class
  if (currentClassIdx >= 0 && currentClassIdx < plan.classes.length - 1) {
    const nextClass = plan.classes[currentClassIdx + 1];
    const targetMinSales = minSalesForClass(plan, nextClass.name);
    const gap = Math.max(0, targetMinSales - currentSales);

    if (gap > 0) {
      const gain = testGain({ sales: targetMinSales });
      const reqDaily = requiredPerDay(targetMinSales, currentSales, remainingWorkingDays);
      const isDifficult =
        currentDailyAvgSales > 0 && reqDaily > 2 * currentDailyAvgSales;

      suggestions.push({
        id: `nextClass-${nextClass.name}`,
        type: 'nextClass',
        priority: 50,
        gainRupees: gain,
        numbers: { gap, gain, reqDaily, minSales: targetMinSales },
        defaultText: `${formatCurrencyINR(gap)} more revenue moves you to Class ${
          nextClass.name
        }. Your payout increases by ${formatCurrencyINR(gain)}.`,
        difficult: isDifficult,
      });

      // 2. ordersNeeded: only if orders > 0 and nextClass exists
      if (totals.orders > 0) {
        const aov = currentSales / totals.orders;
        if (aov > 0) {
          const neededOrders = Math.ceil(gap / aov);
          suggestions.push({
            id: `ordersNeeded-${nextClass.name}`,
            type: 'ordersNeeded',
            priority: 45,
            gainRupees: gain,
            numbers: { neededOrders, aov, gap },
            defaultText: `That is about ${formatNumberINR(
              neededOrders
            )} more orders at your average order value.`,
            difficult: isDifficult,
          });
        }
      }
    }
  }

  // --- 3. FASTEST BONUS ---
  // for connects and talk that are not yet High:
  // extraPerDay = (nextLimit * (activeDays + remainingWorkingDays) - currentTotal) / remainingWorkingDays - currentAverage (talk in minutes)
  // Pick the one with the smallest extraPerDay as a % of the current average.
  const bonusCandidates: Array<{
    name: string;
    unit: string;
    limit: number;
    extraPerDay: number;
    pctOfCurrent: number;
    gain: number;
    metricKey: 'avgConnects' | 'avgTalkMinutes';
  }> = [];

  // Connects
  if (result.connects.band !== 'High') {
    const nextLimit =
      result.connects.band === 'Mid'
        ? plan.bonuses.connects.high
        : plan.bonuses.connects.mid;
    const currentConnectsTotal = totals.connects;
    const currentAvgConnects = currentMetrics.avgConnects;

    if (remainingWorkingDays > 0 && currentAvgConnects > 0) {
      const extraPerDay =
        (nextLimit * (activeDays + remainingWorkingDays) - currentConnectsTotal) /
          remainingWorkingDays -
        currentAvgConnects;

      if (extraPerDay > 0) {
        const gain = testGain({ avgConnects: nextLimit });
        bonusCandidates.push({
          name: 'Unique Connects',
          unit: 'connects',
          limit: nextLimit,
          extraPerDay: Math.ceil(extraPerDay),
          pctOfCurrent: extraPerDay / currentAvgConnects,
          gain,
          metricKey: 'avgConnects',
        });
      }
    }
  }

  // Talk Time (in minutes)
  if (result.talk.band !== 'High') {
    const nextLimit =
      result.talk.band === 'Mid'
        ? plan.bonuses.talkMinutes.high
        : plan.bonuses.talkMinutes.mid;
    const currentTalkMinutesTotal = totals.talkSeconds / 60;
    const currentAvgTalk = currentMetrics.avgTalkMinutes;

    if (remainingWorkingDays > 0 && currentAvgTalk > 0) {
      const extraPerDay =
        (nextLimit * (activeDays + remainingWorkingDays) - currentTalkMinutesTotal) /
          remainingWorkingDays -
        currentAvgTalk;

      if (extraPerDay > 0) {
        const gain = testGain({ avgTalkMinutes: nextLimit });
        bonusCandidates.push({
          name: 'Talk Time',
          unit: 'minutes',
          limit: nextLimit,
          extraPerDay: Math.ceil(extraPerDay),
          pctOfCurrent: extraPerDay / currentAvgTalk,
          gain,
          metricKey: 'avgTalkMinutes',
        });
      }
    }
  }

  if (bonusCandidates.length > 0) {
    // Pick smallest extraPerDay as % of current
    bonusCandidates.sort((a, b) => a.pctOfCurrent - b.pctOfCurrent);
    const best = bonusCandidates[0];
    suggestions.push({
      id: `fastestBonus-${best.metricKey}`,
      type: 'fastestBonus',
      priority: 60,
      gainRupees: best.gain,
      numbers: {
        extraPerDay: best.extraPerDay,
        gain: best.gain,
        nextLimit: best.limit,
      },
      defaultText: `The fastest bonus to unlock is ${best.name}. You need ${
        best.extraPerDay
      } more ${best.unit} each day (+${formatCurrencyINR(best.gain)}).`,
      difficult: false,
    });
  }

  // --- 4. STORE VISITS ---
  // Gap to next tier and payout difference
  // Don't show if already at highest tier
  const currentTierNum = result.rider.tier;
  const currentTierIndex = plan.visitTiers.findIndex((t) => t.tier === currentTierNum);
  const nextTier =
    currentTierIndex === -1
      ? plan.visitTiers[0]
      : plan.visitTiers[currentTierIndex + 1];

  if (nextTier) {
    const gap = Math.max(0, nextTier.min - totals.visitsAttributed);
    const gain = testGain({ visitsAttributed: nextTier.min });
    suggestions.push({
      id: `storeVisits-tier${nextTier.tier}`,
      type: 'storeVisits',
      priority: 40,
      gainRupees: gain,
      numbers: { gap, tier: nextTier.tier, gain },
      defaultText: `You need ${formatNumberINR(gap)} more store visits to reach Tier ${
        nextTier.tier
      } (+${formatCurrencyINR(gain)}).`,
      difficult: false,
    });
  }

  // --- 5. PROJECTION ---
  // Final sales and visits at current speed, current averages for the rest
  const projectedSales = Math.round(
    calculateProjection(currentSales, activeDays, remainingWorkingDays)
  );
  const projectedVisits = Math.round(
    calculateProjection(totals.visitsAttributed, activeDays, remainingWorkingDays)
  );
  const projectedResult = calculateFromMetrics(
    {
      ...currentMetrics,
      sales: projectedSales,
      visitsAttributed: projectedVisits,
    },
    plan
  );

  suggestions.push({
    id: 'projection',
    type: 'projection',
    priority: 30,
    gainRupees: 0,
    numbers: {
      projectedSales,
      projectedVisits,
      projectedTotal: projectedResult.total,
      achievementPct: projectedResult.achievementPct,
    },
    defaultText: `At your current speed, you will finish at ${formatNumberINR(
      projectedResult.achievementPct,
      0
    )}% (Class ${projectedResult.className}) with ${formatCurrencyINR(
      projectedResult.total
    )}.`,
    difficult: false,
  });

  // --- 6. WARNING (priority highest: 1000) ---
  // the average of the last 7 active days (day > 0) is below the limit of the current band while the cycle average is at or above it, for connects or talk;
  // or the quality score is exactly at a band limit.
  const activeEntries = (daily || []).filter((d) => d.day > 0);
  const last7Active = activeEntries.slice(-7);

  if (last7Active.length > 0) {
    const sumActiveDays7 = last7Active.reduce((acc, d) => acc + d.day, 0);

    // Connects warning
    if (result.connects.band === 'High' || result.connects.band === 'Mid') {
      const currentBandLimit =
        result.connects.band === 'High'
          ? plan.bonuses.connects.high
          : plan.bonuses.connects.mid;
      const lowerBandName = result.connects.band === 'High' ? 'Mid' : 'None';
      const sumConnects7 = last7Active.reduce((acc, d) => acc + d.connects, 0);
      const avg7Connects =
        sumActiveDays7 > 0 ? Math.round(sumConnects7 / sumActiveDays7) : 0;

      if (avg7Connects < currentBandLimit && currentMetrics.avgConnects >= currentBandLimit) {
        // Gain difference if dropped
        const lowerLimit =
          result.connects.band === 'High'
            ? plan.bonuses.connects.mid
            : plan.bonuses.connects.mid - 1;
        const loss = currentTotal - calculateFromMetrics({ ...currentMetrics, avgConnects: lowerLimit }, plan).total;

        suggestions.push({
          id: 'warning-connects',
          type: 'warning',
          priority: 1000,
          gainRupees: 0,
          numbers: { avg7: avg7Connects, loss },
          defaultText: `Warning: your Connects average in the last 7 days is ${avg7Connects}. You can drop from ${result.connects.band} to ${lowerBandName} (-${formatCurrencyINR(loss)}).`,
          difficult: false,
        });
      }
    }

    // Talk Time warning
    if (result.talk.band === 'High' || result.talk.band === 'Mid') {
      const currentBandLimit =
        result.talk.band === 'High'
          ? plan.bonuses.talkMinutes.high
          : plan.bonuses.talkMinutes.mid;
      const lowerBandName = result.talk.band === 'High' ? 'Mid' : 'None';
      const sumTalkSec7 = last7Active.reduce((acc, d) => acc + d.talkSeconds, 0);
      const avg7TalkMin =
        sumActiveDays7 > 0 ? Math.round(sumTalkSec7 / 60 / sumActiveDays7) : 0;

      if (avg7TalkMin < currentBandLimit && currentMetrics.avgTalkMinutes >= currentBandLimit) {
        const lowerLimit =
          result.talk.band === 'High'
            ? plan.bonuses.talkMinutes.mid
            : plan.bonuses.talkMinutes.mid - 1;
        const loss = currentTotal - calculateFromMetrics({ ...currentMetrics, avgTalkMinutes: lowerLimit }, plan).total;

        suggestions.push({
          id: 'warning-talk',
          type: 'warning',
          priority: 1000,
          gainRupees: 0,
          numbers: { avg7: avg7TalkMin, loss },
          defaultText: `Warning: your Talk Time average in the last 7 days is ${avg7TalkMin} min. You can drop from ${result.talk.band} to ${lowerBandName} (-${formatCurrencyINR(loss)}).`,
          difficult: false,
        });
      }
    }
  }

  // Quality score within 1 point of a band limit (design section 8.1): at the limit or 1 point above it
  if (currentMetrics.qualityScore !== null) {
    const q = currentMetrics.qualityScore;
    const { high, mid } = plan.bonuses.quality;
    const bandName: 'High' | 'Mid' | null =
      q >= high ? (q - high <= 1 ? 'High' : null) : q >= mid && q - mid <= 1 ? 'Mid' : null;
    if (bandName) {
      const lowerBand = bandName === 'High' ? 'Mid' : 'None';
      suggestions.push({
        id: 'warning-quality',
        type: 'warning',
        priority: 1000,
        gainRupees: 0,
        numbers: { score: q },
        defaultText: `Warning: your Quality score (${q}) is right on the edge of the ${bandName} band. One low score will drop you to ${lowerBand}.`,
        difficult: false,
      });
    }
  }

  // --- 7. STREAK ---
  // The number of most recent active days in a row where the daily value is at or above the High limit, for connects or talk.
  // Show only if 3 or more.
  if (activeEntries.length >= 3) {
    // Check connects streak
    let connectsStreak = 0;
    for (let i = activeEntries.length - 1; i >= 0; i--) {
      if (activeEntries[i].connects >= plan.bonuses.connects.high) {
        connectsStreak++;
      } else {
        break;
      }
    }

    if (connectsStreak >= 3) {
      suggestions.push({
        id: 'streak-connects',
        type: 'streak',
        priority: 35,
        gainRupees: 0,
        numbers: { streak: connectsStreak, limit: plan.bonuses.connects.high },
        defaultText: `${connectsStreak} days in a row at ${plan.bonuses.connects.high}+ connects. Keep the streak alive!`,
        difficult: false,
      });
    }

    // Check talk streak
    let talkStreak = 0;
    for (let i = activeEntries.length - 1; i >= 0; i--) {
      const dailyTalkMin = Math.round(activeEntries[i].talkSeconds / 60);
      if (dailyTalkMin >= plan.bonuses.talkMinutes.high) {
        talkStreak++;
      } else {
        break;
      }
    }

    if (talkStreak >= 3) {
      suggestions.push({
        id: 'streak-talk',
        type: 'streak',
        priority: 35,
        gainRupees: 0,
        numbers: { streak: talkStreak, limit: plan.bonuses.talkMinutes.high },
        defaultText: `${talkStreak} days in a row at ${plan.bonuses.talkMinutes.high}+ minutes talk time. Keep the streak alive!`,
        difficult: false,
      });
    }
  }

  // --- 8. MILESTONE ---
  // The last multiple of Rs 10,00,000 that sales crossed. Text: "You crossed Rs <50,00,000> in revenue!"
  if (currentSales >= 1000000) {
    const milestoneSales = Math.floor(currentSales / 1000000) * 1000000;
    suggestions.push({
      id: `milestone-${milestoneSales}`,
      type: 'milestone',
      priority: 20,
      gainRupees: 0,
      numbers: { milestoneSales },
      defaultText: `You crossed ${formatCurrencyINR(milestoneSales)} in revenue!`,
      difficult: false,
    });
  }

  // --- SORT AND LIMIT ---
  // Warnings first, then by gainRupees descending
  const warnings = suggestions.filter((s) => s.type === 'warning');
  const others = suggestions.filter((s) => s.type !== 'warning');

  others.sort((a, b) => b.gainRupees - a.gainRupees || b.priority - a.priority);

  const topSuggestions = [...warnings, ...others].slice(0, 5);

  // Return headline first or topSuggestions with headline included
  return [headlineSuggestion, ...topSuggestions];
}

/**
 * Pre Sales suggestions: quality gate, next calls tier, next talk-time tier, streak.
 * Same shape as buildSuggestions: headline first, then warnings, then the rest by rupee gain (max 5).
 */
export function buildPreSalesSuggestions(
  agentRecord: AgentRecord | null | undefined,
  plan: PreSalesPlan,
  cycle: Cycle
): Suggestion[] {
  if (!agentRecord || !agentRecord.totals || agentRecord.totals.activeDays <= 0) {
    return [];
  }

  const { totals, quality, daily, lastDataDate } = agentRecord;
  const activeDays = totals.activeDays;
  const metrics = preSalesMetricsFromTotals(totals, quality, plan);
  const calc = calculatePreSales(metrics, plan);
  const ps = calc.preSales;
  if (!ps) return [];

  const remaining = calculateRemainingWorkingDays(
    lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );
  const gate = plan.qualityGate;
  const callsTiers = [...plan.calls].sort((a, b) => a.min - b.min);
  const talkTiers = [...plan.talkSeconds].sort((a, b) => a.min - b.min);
  const totalCalls = totals.calls ?? 0;
  const suggestions: Suggestion[] = [];

  // --- Headline: Day X of Y ---
  const startMs = new Date(cycle.startDate + 'T00:00:00Z').getTime();
  const endMs = new Date(cycle.endDate + 'T00:00:00Z').getTime();
  const totalDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
  const lastMs = lastDataDate ? new Date(lastDataDate + 'T00:00:00Z').getTime() : startMs;
  const elapsed = Math.max(
    1,
    Math.min(totalDays, Math.round((lastMs - startMs) / (1000 * 60 * 60 * 24)) + 1)
  );

  let headlineText: string;
  if (ps.eligible) {
    headlineText = `Day ${elapsed} of ${totalDays}: you have earned ${formatCurrencyINR(calc.total)} so far.`;
  } else if (ps.potentialTotal > 0) {
    headlineText = `Day ${elapsed} of ${totalDays}: reach a Quality Score of ${gate}% to unlock ${formatCurrencyINR(ps.potentialTotal)}.`;
  } else {
    headlineText = `Day ${elapsed} of ${totalDays}: keep going. Your first payout starts at ${callsTiers[0]?.min ?? 0} calls a day.`;
  }

  const headlineSuggestion: Suggestion = {
    id: 'headline',
    type: 'headline',
    priority: 100,
    gainRupees: 0,
    numbers: { day: elapsed, totalDays, total: calc.total },
    defaultText: headlineText,
    difficult: false,
  };

  // --- Quality gate (both incentives need the minimum Quality Score) ---
  const score = metrics.qualityScore;
  if (score === null) {
    suggestions.push({
      id: 'warning-quality-gate',
      type: 'warning',
      priority: 1000,
      gainRupees: 0,
      numbers: { gate, potential: ps.potentialTotal },
      defaultText: `No Quality audit yet. You need a Quality Score of ${gate}% or more to receive your Calls and Talk Time incentives.`,
      difficult: false,
    });
  } else if (score < gate) {
    suggestions.push({
      id: 'warning-quality-gate',
      type: 'warning',
      priority: 1000,
      gainRupees: 0,
      numbers: { score, gate, potential: ps.potentialTotal },
      defaultText:
        ps.potentialTotal > 0
          ? `Your Quality Score is ${score}%. Reach ${gate}% to unlock ${formatCurrencyINR(ps.potentialTotal)}.`
          : `Your Quality Score is ${score}%. You need ${gate}% or more to receive your incentives.`,
      difficult: false,
    });
  } else if (score - gate <= 1 && ps.potentialTotal > 0) {
    suggestions.push({
      id: 'warning-quality-gate',
      type: 'warning',
      priority: 1000,
      gainRupees: 0,
      numbers: { score, gate, potential: ps.potentialTotal },
      defaultText: `Warning: your Quality Score (${score}) is right on the edge of the ${gate}% you need. One low audit can lock ${formatCurrencyINR(ps.potentialTotal)}.`,
      difficult: false,
    });
  }

  // --- Next calls tier ---
  const nextCalls = callsTiers.find((t) => t.min > metrics.avgCalls);
  if (nextCalls && remaining > 0) {
    const extra =
      (nextCalls.min * (activeDays + remaining) - totalCalls) / remaining - metrics.avgCalls;
    if (extra > 0) {
      const gain = nextCalls.payout - pickPreSalesTier(plan.calls, metrics.avgCalls).payout;
      suggestions.push({
        id: 'fastestBonus-calls',
        type: 'fastestBonus',
        priority: 60,
        gainRupees: gain,
        numbers: { extraPerDay: Math.ceil(extra), gain, nextLimit: nextCalls.min },
        defaultText: `The next calls tier starts at ${nextCalls.min} calls a day. You need ${Math.ceil(extra)} more calls each day (+${formatCurrencyINR(gain)}).`,
        difficult: metrics.avgCalls > 0 && extra > metrics.avgCalls,
      });
    }
  }

  // --- Next talk-time tier (talk time is an average per call, so the maths follows the plan's method) ---
  const nextTalk = talkTiers.find((t) => t.min > metrics.avgTalkSeconds);
  if (nextTalk && remaining > 0 && metrics.avgTalkSeconds > 0) {
    const weightCalls = totals.ttWeightCalls ?? 0;
    const futureCalls = (totalCalls / activeDays) * remaining;
    let neededAvg: number;
    if (plan.talkMethod === 'weighted' && weightCalls > 0 && futureCalls > 0) {
      neededAvg =
        (nextTalk.min * (weightCalls + futureCalls) - (totals.ttWeightedSum ?? 0)) / futureCalls;
    } else {
      neededAvg =
        (nextTalk.min * ((totals.ttRows ?? 0) + remaining) - (totals.ttSum ?? 0)) / remaining;
    }
    const extra = neededAvg - metrics.avgTalkSeconds;
    if (extra > 0) {
      const gain = nextTalk.payout - pickPreSalesTier(plan.talkSeconds, metrics.avgTalkSeconds).payout;
      suggestions.push({
        id: 'fastestBonus-talk',
        type: 'fastestBonus',
        priority: 55,
        gainRupees: gain,
        numbers: { extraSeconds: Math.ceil(extra), gain, nextLimit: nextTalk.min },
        defaultText: `The next talk time tier starts at ${nextTalk.min} seconds. You need about ${Math.ceil(extra)} more seconds on each call from now on (+${formatCurrencyINR(gain)}).`,
        difficult: extra > metrics.avgTalkSeconds,
      });
    }
  }

  // --- Streak: most recent active days in a row at or above the first calls tier ---
  const activeEntries = (daily || []).filter((d) => d.day > 0);
  if (activeEntries.length >= 3 && callsTiers.length > 0) {
    const limit = callsTiers[0].min;
    let streak = 0;
    for (let i = activeEntries.length - 1; i >= 0; i--) {
      if ((activeEntries[i].calls ?? 0) >= limit) streak++;
      else break;
    }
    if (streak >= 3) {
      suggestions.push({
        id: 'streak-calls',
        type: 'streak',
        priority: 35,
        gainRupees: 0,
        numbers: { streak, limit },
        defaultText: `${streak} days in a row at ${limit}+ calls. Keep the streak alive!`,
        difficult: false,
      });
    }
  }

  // --- Sort and limit: warnings first, then by rupee gain ---
  const warnings = suggestions.filter((s) => s.type === 'warning');
  const others = suggestions.filter((s) => s.type !== 'warning');
  others.sort((a, b) => b.gainRupees - a.gainRupees || b.priority - a.priority);

  return [headlineSuggestion, ...[...warnings, ...others].slice(0, 5)];
}

/** Suggestions for any agent: picks the Pre Sales or the revenue rules from the agent's type. */
export function buildAgentSuggestions(
  agentRecord: AgentRecord | null | undefined,
  cycle: Cycle
): Suggestion[] {
  if (!agentRecord) return [];
  if (agentRecord.agentType === 'PRE_SALES') {
    return buildPreSalesSuggestions(agentRecord, getPreSalesPlan(cycle), cycle);
  }
  return buildSuggestions(agentRecord, getRevenuePlan(cycle, agentRecord.agentType), cycle);
}
