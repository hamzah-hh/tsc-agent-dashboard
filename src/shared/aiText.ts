import { AgentRecord } from './types';

/**
 * A short string of everything the coaching text depends on: the agent type, the data date, the
 * incentive result and the totals behind it. AI text is written for one exact state of an agent.
 * If any of these numbers change (a corrected sync on the same day, a rule change), the fingerprint
 * changes and the old text is no longer shown, so a stale "+₹1,200" can never appear next to new numbers.
 */
export function aiFingerprint(
  a: Pick<AgentRecord, 'agentType' | 'lastDataDate' | 'result' | 'totals' | 'quality'>
): string {
  const t = a.totals || ({} as AgentRecord['totals']);
  return [
    a.agentType,
    a.lastDataDate,
    a.result?.total,
    a.result?.className,
    t.activeDays,
    t.sales,
    t.connects,
    t.talkSeconds,
    t.visitsAttributed,
    t.calls ?? 0,
    t.ttWeightedSum ?? 0,
    a.quality?.audits,
    a.quality?.score,
  ].join('|');
}

/** True when the stored AI text was written for the agent's current numbers. */
export function aiTextIsCurrent(a: AgentRecord | null | undefined): boolean {
  const ai = a?.aiSuggestions;
  if (!a || !ai) return false;
  if (ai.fingerprint) return ai.fingerprint === aiFingerprint(a);
  // Text saved before fingerprints existed: fall back to the data date
  return ai.lastDataDate === a.lastDataDate;
}
