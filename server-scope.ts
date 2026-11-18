import { normalizeEmail } from './src/shared/incentive';
import type { AgentRecord } from './src/shared/types';

/**
 * Determines whether an agent belongs to a Team Leader.
 * Checks personal email, official email, and location.
 * (Moved here from server-routes.ts so the roster uses the same rule as the rest of the app.)
 */
export function isAgentOfTl(
  agent: AgentRecord,
  tlUserEmail: string,
  tlAccess?: { officialEmail?: string; location?: string }
): boolean {
  const tlPersonal = normalizeEmail(tlUserEmail);
  const tlOfficial = normalizeEmail(tlAccess?.officialEmail);
  const agentTlPersonal = normalizeEmail(agent.tlPersonalEmail);
  const agentTlOfficial = normalizeEmail(agent.tlOfficialEmail);

  // 1. Direct match on TL Personal Email
  if (tlPersonal && agentTlPersonal && agentTlPersonal === tlPersonal) {
    return true;
  }

  // 2. Direct match on TL Official Email (agents sheet has TL_Official_Email)
  if (tlOfficial && agentTlOfficial && agentTlOfficial === tlOfficial) {
    return true;
  }

  // 3. Cross matches (if login is official email, or sheet had personal/official swapped)
  if (tlPersonal && agentTlOfficial && agentTlOfficial === tlPersonal) {
    return true;
  }
  if (tlOfficial && agentTlPersonal && agentTlPersonal === tlOfficial) {
    return true;
  }

  // 4. Fallback: If neither personal nor official TL was assigned on the agent, location is the team
  if (!agentTlPersonal && !agentTlOfficial && tlAccess?.location) {
    const tlLoc = tlAccess.location.trim().toLowerCase();
    const agLoc = (agent.location || '').trim().toLowerCase();
    if (tlLoc === agLoc) return true;
    if (tlLoc === 'dighe' && agLoc === 'dighe (pre sales)') return true;
  }

  return false;
}
