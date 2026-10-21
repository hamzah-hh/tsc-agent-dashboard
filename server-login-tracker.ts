import { adminDb } from './server-firebase-admin';
import { LoginTrackerConfig, AgentLoginSessionState, AgentDailyLoginActivity } from './src/shared/types';
import { normalizeEmail } from './src/shared/incentive';

export const DEFAULT_LOGIN_TRACKER_CONFIG: LoginTrackerConfig = {
  enabled: true,
  amWindowMinutes: 30, // 30 min in AM (12:00 AM - 11:59 AM)
  pmWindowMinutes: 30, // 30 min in PM (12:00 PM - 11:59 PM)
  timezone: 'Asia/Kolkata',
};

/**
 * Computes window metadata (AM vs PM, current IST date, limits, and time until window close).
 */
export function getWindowInfo(now: Date = new Date(), config?: LoginTrackerConfig) {
  const tz = config?.timezone || DEFAULT_LOGIN_TRACKER_CONFIG.timezone || 'Asia/Kolkata';

  // Format date and time parts strictly in IST
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const year = map.year;
  const month = map.month;
  const day = map.day;
  const hour = parseInt(map.hour || '0', 10);
  const minute = parseInt(map.minute || '0', 10);
  const second = parseInt(map.second || '0', 10);

  const dateKey = `${year}-${month}-${day}`;
  const isAm = hour < 12;
  const windowId: 'AM' | 'PM' = isAm ? 'AM' : 'PM';

  const amLimit = config?.amWindowMinutes !== undefined ? config.amWindowMinutes : DEFAULT_LOGIN_TRACKER_CONFIG.amWindowMinutes;
  const pmLimit = config?.pmWindowMinutes !== undefined ? config.pmWindowMinutes : DEFAULT_LOGIN_TRACKER_CONFIG.pmWindowMinutes;
  const windowLimitMinutes = isAm ? amLimit : pmLimit;
  const windowLimitSeconds = Math.max(1, windowLimitMinutes * 60);

  // Seconds until this window ends
  const endHour = isAm ? 12 : 24;
  const secondsUntilWindowEnd = Math.max(0, endHour * 3600 - (hour * 3600 + minute * 60 + second));
  const nextWindowOpensAt = isAm ? '12:00 PM IST' : '12:00 AM IST';

  return {
    dateKey,
    windowId,
    isAm,
    hour,
    minute,
    second,
    windowLimitMinutes,
    windowLimitSeconds,
    secondsUntilWindowEnd,
    nextWindowOpensAt,
  };
}

// Heartbeats come every 60 s from every open agent session. Reading and writing Firestore on each one used up
// most of the free daily quota, so the day's record is kept in memory and saved at most every
// PERSIST_EVERY_MS (at once for the first heartbeat of a window, and when the time left runs low).
// A restarted or second server instance reads the saved copy, so at most PERSIST_EVERY_MS of use goes uncounted.
const ACTIVITY_CACHE_MS = 3 * 60000;
const PERSIST_EVERY_MS = 2 * 60000;
const LOW_REMAINING_SECONDS = 150;
const activityCache = new Map<string, { at: number; persistedAt: number; data: Partial<AgentDailyLoginActivity> | null }>();

async function readActivity(docId: string, nowMs: number) {
  const hit = activityCache.get(docId);
  if (hit && nowMs - hit.at < ACTIVITY_CACHE_MS) return hit;
  const snap = await adminDb.collection('loginActivity').doc(docId).get();
  const entry = { at: nowMs, persistedAt: nowMs, data: snap.exists ? (snap.data() as Partial<AgentDailyLoginActivity>) : null };
  activityCache.set(docId, entry);
  return entry;
}

/**
 * Checks whether an agent is allowed to access the dashboard right now.
 */
export async function checkAgentAllowance(
  agentEmail: string,
  config?: LoginTrackerConfig,
  now: Date = new Date()
): Promise<AgentLoginSessionState> {
  const isEnabled = config?.enabled !== false;
  const windowInfo = getWindowInfo(now, config);

  if (!isEnabled) {
    return {
      enabled: false,
      windowId: windowInfo.windowId,
      dateKey: windowInfo.dateKey,
      remainingSeconds: 86400,
      windowLimitMinutes: windowInfo.windowLimitMinutes,
      usedSeconds: 0,
      secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
      allowed: true,
      nextWindowOpensAt: windowInfo.nextWindowOpensAt,
    };
  }

  const cleanEmail = normalizeEmail(agentEmail);
  const docId = `${cleanEmail}_${windowInfo.dateKey}`;
  const data = (await readActivity(docId, now.getTime())).data;

  const usedSeconds = windowInfo.isAm
    ? data?.amSecondsUsed || 0
    : data?.pmSecondsUsed || 0;

  const remainingSeconds = Math.max(0, windowInfo.windowLimitSeconds - usedSeconds);
  const allowed = remainingSeconds > 0;

  let reason: string | undefined = undefined;
  if (!allowed) {
    const windowLabel = windowInfo.isAm
      ? 'AM window (12:00 AM – 11:59 AM)'
      : 'PM window (12:00 PM – 11:59 PM)';
    reason = `Time Limit Exceeded: You have used your ${windowInfo.windowLimitMinutes}-minute access limit for the ${windowLabel}. Your next access window opens at ${windowInfo.nextWindowOpensAt}.`;
  }

  return {
    enabled: true,
    windowId: windowInfo.windowId,
    dateKey: windowInfo.dateKey,
    remainingSeconds,
    windowLimitMinutes: windowInfo.windowLimitMinutes,
    usedSeconds,
    secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
    allowed,
    reason,
    nextWindowOpensAt: windowInfo.nextWindowOpensAt,
  };
}

/**
 * Records an active heartbeat from an agent and accumulates time used.
 */
export async function recordAgentHeartbeat(
  agentEmail: string,
  config?: LoginTrackerConfig,
  now: Date = new Date()
): Promise<AgentLoginSessionState> {
  const isEnabled = config?.enabled !== false;
  const windowInfo = getWindowInfo(now, config);

  if (!isEnabled) {
    return {
      enabled: false,
      windowId: windowInfo.windowId,
      dateKey: windowInfo.dateKey,
      remainingSeconds: 86400,
      windowLimitMinutes: windowInfo.windowLimitMinutes,
      usedSeconds: 0,
      secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
      allowed: true,
      nextWindowOpensAt: windowInfo.nextWindowOpensAt,
    };
  }

  const cleanEmail = normalizeEmail(agentEmail);
  const docId = `${cleanEmail}_${windowInfo.dateKey}`;
  const docRef = adminDb.collection('loginActivity').doc(docId);
  const nowMs = now.getTime();
  const cached = await readActivity(docId, nowMs);
  const data = cached.data;
  const lastTime = data?.lastHeartbeatTime;
  const lastWindow = data?.lastWindow;

  // Calculate elapsed active seconds since last heartbeat
  let delta = 0;
  if (lastTime && lastWindow === windowInfo.windowId) {
    const diffMs = nowMs - lastTime;
    // Heartbeats are sent every 60s. If diff is under 100s, count actual elapsed seconds
    if (diffMs > 0 && diffMs <= 100000) {
      delta = Math.min(75, Math.max(1, Math.round(diffMs / 1000)));
    } else {
      // Returned after idle/away or new tab, count 1 second for reconnection
      delta = 1;
    }
  } else {
    // Initial heartbeat of this session/window
    delta = 1;
  }

  const prevAm = data?.amSecondsUsed || 0;
  const prevPm = data?.pmSecondsUsed || 0;

  const newAm = windowInfo.isAm ? prevAm + delta : prevAm;
  const newPm = !windowInfo.isAm ? prevPm + delta : prevPm;
  const currentUsed = windowInfo.isAm ? newAm : newPm;

  const remainingSeconds = Math.max(0, windowInfo.windowLimitSeconds - currentUsed);
  const allowed = remainingSeconds > 0;

  const next: Partial<AgentDailyLoginActivity> = {
    agentEmail: cleanEmail,
    date: windowInfo.dateKey,
    amSecondsUsed: newAm,
    pmSecondsUsed: newPm,
    lastHeartbeatTime: nowMs,
    lastWindow: windowInfo.windowId,
    updatedAt: now.toISOString(),
  };
  const neverSaved = !data;
  const windowChanged = Boolean(lastWindow) && lastWindow !== windowInfo.windowId;
  const due = nowMs - cached.persistedAt >= PERSIST_EVERY_MS;
  const persist = neverSaved || windowChanged || due || remainingSeconds <= LOW_REMAINING_SECONDS;
  activityCache.set(docId, { at: nowMs, persistedAt: persist ? nowMs : cached.persistedAt, data: { ...data, ...next } });
  if (persist) await docRef.set(next, { merge: true });

  let reason: string | undefined = undefined;
  if (!allowed) {
    const windowLabel = windowInfo.isAm
      ? 'AM window (12:00 AM – 11:59 AM)'
      : 'PM window (12:00 PM – 11:59 PM)';
    reason = `Time Limit Exceeded: You have completed your ${windowInfo.windowLimitMinutes}-minute access limit for the ${windowLabel}. Your next access window opens at ${windowInfo.nextWindowOpensAt}.`;
  }

  return {
    enabled: true,
    windowId: windowInfo.windowId,
    dateKey: windowInfo.dateKey,
    remainingSeconds,
    windowLimitMinutes: windowInfo.windowLimitMinutes,
    usedSeconds: currentUsed,
    secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
    allowed,
    reason,
    nextWindowOpensAt: windowInfo.nextWindowOpensAt,
  };
}

/**
 * Resets an agent's used time for a specific date (used by Super Admin).
 */
export async function resetAgentLoginUsage(agentEmail: string, dateKey?: string, now = new Date()) {
  const windowInfo = getWindowInfo(now);
  const targetDateKey = dateKey || windowInfo.dateKey;
  const cleanEmail = normalizeEmail(agentEmail);
  const docId = `${cleanEmail}_${targetDateKey}`;
  activityCache.delete(docId);

  await adminDb.collection('loginActivity').doc(docId).set(
    {
      agentEmail: cleanEmail,
      date: targetDateKey,
      amSecondsUsed: 0,
      pmSecondsUsed: 0,
      lastHeartbeatTime: undefined,
      lastWindow: undefined,
      updatedAt: now.toISOString(),
      resetByAdminAt: now.toISOString(),
    },
    { merge: true }
  );
}

/**
 * Retrieves today's active agent usage records for Super Admin inspection.
 */
export async function getTodayLoginActivities(dateKey?: string, now = new Date()): Promise<AgentDailyLoginActivity[]> {
  const windowInfo = getWindowInfo(now);
  const targetDateKey = dateKey || windowInfo.dateKey;

  const snap = await adminDb
    .collection('loginActivity')
    .where('date', '==', targetDateKey)
    .get();

  return snap.docs.map((d) => d.data() as AgentDailyLoginActivity);
}
