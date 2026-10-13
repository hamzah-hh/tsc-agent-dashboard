/**
 * Storage for the Overall Team Summary page: the Breaks and Targets tabs of the clean sheet.
 *
 * cycles/{cycle}/data/teamOps            { breakChunks, breaksCount, targets, updatedAt }
 * cycles/{cycle}/data/teamOps/chunks/breaks-N   { rows }  (1,000 agent-days a document, well under 1 MiB)
 */
import { adminDb } from './server-firebase-admin';
import { BreakDay, TargetRow } from './src/shared/teamOps';

const CHUNK = 1000;
const TTL_MS = 30000;
const cache = new Map<string, { at: number; value: TeamOpsData }>();

export interface TeamOpsData {
  breaks: BreakDay[];
  targets: TargetRow[];
  updatedAt: string | null;
}

const headRef = (cycleId: string) => adminDb.collection('cycles').doc(cycleId).collection('data').doc('teamOps');
const chunksCol = (cycleId: string) => headRef(cycleId).collection('chunks');

export function invalidateTeamOpsCache(): void {
  cache.clear();
}

/** Saves the tabs that were sent; a tab that was not sent (null) keeps what is saved. */
export async function saveTeamOps(cycleId: string, breaks: BreakDay[] | null, targets: TargetRow[] | null): Promise<void> {
  if (breaks === null && targets === null) return;
  const prev = await headRef(cycleId).get();
  const prevData: any = prev.exists ? prev.data() : {};
  const batch = adminDb.batch();
  const head: Record<string, any> = {
    breakChunks: prevData.breakChunks || 0,
    breaksCount: prevData.breaksCount || 0,
    targets: prevData.targets || [],
    updatedAt: new Date().toISOString(),
  };
  if (breaks !== null) {
    const parts: BreakDay[][] = [];
    for (let i = 0; i < breaks.length; i += CHUNK) parts.push(breaks.slice(i, i + CHUNK));
    parts.forEach((rows, i) => batch.set(chunksCol(cycleId).doc(`breaks-${i}`), { rows }));
    for (let i = parts.length; i < (prevData.breakChunks || 0); i++) batch.delete(chunksCol(cycleId).doc(`breaks-${i}`));
    head.breakChunks = parts.length;
    head.breaksCount = breaks.length;
  }
  if (targets !== null) head.targets = targets;
  batch.set(headRef(cycleId), head);
  await batch.commit();
  invalidateTeamOpsCache();
}

export async function loadTeamOps(cycleId: string): Promise<TeamOpsData> {
  const hit = cache.get(cycleId);
  if (hit && Date.now() - hit.at < TTL_MS) return structuredClone(hit.value);
  const snap = await headRef(cycleId).get();
  let value: TeamOpsData = { breaks: [], targets: [], updatedAt: null };
  if (snap.exists) {
    const d: any = snap.data();
    const parts = await Promise.all(
      Array.from({ length: d.breakChunks || 0 }, (_, i) => chunksCol(cycleId).doc(`breaks-${i}`).get())
    );
    value = {
      breaks: parts.flatMap((p: any) => (p.exists ? p.data()?.rows || [] : [])),
      targets: d.targets || [],
      updatedAt: d.updatedAt || null,
    };
  }
  cache.set(cycleId, { at: Date.now(), value: structuredClone(value) });
  return value;
}
