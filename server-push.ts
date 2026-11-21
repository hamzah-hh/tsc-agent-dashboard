/**
 * Web push for the in-app inbox. Every row written to app_notification is pushed once, to the devices of the
 * people it is addressed to, by whichever request notices it first (the claim is a single UPDATE, so two
 * requests never send it twice). Switched on only when VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.
 */
import * as webpush from 'web-push';
import type { Queryable } from './server-roster-db';

export interface PushPayload {
  title: string;
  body: string;
  kind: string;
  url: string;
}
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

let senderOverride: PushSender | null = null;
/** Tests replace the real sender. Pass null to use the real one again. */
export function setPushSenderForTests(fn: PushSender | null): void {
  senderOverride = fn;
}

export const pushPublicKey = () => (process.env.VAPID_PUBLIC_KEY || '').trim();
export const pushConfigured = () => Boolean(pushPublicKey() && (process.env.VAPID_PRIVATE_KEY || '').trim());

let vapidSet = '';
const realSender: PushSender = async (target, payload) => {
  const key = pushPublicKey() + '|' + (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (vapidSet !== key) {
    // The subject is shown to push services: the site address, never a person's email
    webpush.setVapidDetails((process.env.VAPID_SUBJECT || 'https://tsc-agent-dashboard.vercel.app').trim(), pushPublicKey(), (process.env.VAPID_PRIVATE_KEY || '').trim());
    vapidSet = key;
  }
  await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' });
};
const send = (target: PushTarget, payload: PushPayload) => (senderOverride ?? realSender)(target, payload);

/** Sends to one device; a device that is gone (404/410) or keeps failing is removed. */
async function sendToDetailed(db: Queryable, sub: PushTarget & { id: number }, payload: PushPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    await send(sub, payload);
    await db.query(`UPDATE push_subscription SET failed_count = 0 WHERE id = $1::bigint AND failed_count <> 0`, [sub.id]);
    return { ok: true };
  } catch (err: any) {
    const status = Number(err?.statusCode ?? err?.status);
    if (status === 404 || status === 410) {
      await db.query(`DELETE FROM push_subscription WHERE id = $1::bigint`, [sub.id]);
    } else {
      await db.query(`UPDATE push_subscription SET failed_count = failed_count + 1 WHERE id = $1::bigint`, [sub.id]);
      await db.query(`DELETE FROM push_subscription WHERE id = $1::bigint AND failed_count >= 8`, [sub.id]);
    }
    return { ok: false, error: `${status || 'error'}${err?.body ? ': ' + String(err.body).slice(0, 120) : err?.message ? ': ' + String(err.message).slice(0, 120) : ''}` };
  }
}
const sendTo = async (db: Queryable, sub: PushTarget & { id: number }, payload: PushPayload): Promise<boolean> => (await sendToDetailed(db, sub, payload)).ok;

/** Pushes the notifications written in the last hour that nobody has pushed yet. Never throws. */
export async function dispatchPendingPushes(db: Queryable, budgetMs = 4000): Promise<number> {
  if (!pushConfigured() && !senderOverride) return 0;
  const work = async () => {
    const claimed = await db.query(
      `UPDATE app_notification SET pushed_at = now()
       WHERE pushed_at IS NULL AND created_at > now() - interval '1 hour'
       RETURNING id, recipient, kind, title, body`
    );
    if (!claimed.length) return 0;
    const recipients = [...new Set(claimed.map((n) => String(n.recipient)))];
    const subs = await db.query(
      `SELECT id::int AS id, endpoint, p256dh, auth, keys FROM push_subscription WHERE keys && $1::text[]`,
      [recipients]
    );
    let sent = 0;
    const jobs: Promise<void>[] = [];
    for (const sub of subs) {
      const mine = claimed.filter((n) => (sub.keys as string[]).includes(String(n.recipient))).sort((a, b) => Number(a.id) - Number(b.id));
      if (!mine.length) continue;
      // A burst becomes one summary instead of a pile of buzzes
      const payloads: PushPayload[] =
        mine.length <= 3
          ? mine.map((n) => ({ title: String(n.title), body: String(n.body || ''), kind: String(n.kind), url: '/' }))
          : [{ title: `${mine.length} new roster updates`, body: 'Open the Roster tab to see them.', kind: 'summary', url: '/' }];
      jobs.push(
        (async () => {
          for (const p of payloads) {
            if (await sendTo(db, sub as any, p)) sent++;
            else break;
          }
        })()
      );
    }
    await Promise.all(jobs);
    return sent;
  };
  try {
    return await Promise.race([work(), new Promise<number>((resolve) => setTimeout(() => resolve(0), budgetMs))]);
  } catch (err: any) {
    console.error('[push] dispatch failed:', err?.message || err);
    return 0;
  }
}

/** A test push to one person's own devices. Returns how many were reached. */
export async function sendTestPush(db: Queryable, loginEmail: string): Promise<number> {
  return (await sendPushToLogin(db, loginEmail, { title: 'Notifications are on', body: 'You will get roster updates here.', kind: 'test', url: '/' })).reached;
}

export interface DeviceInfo {
  id: number;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  failedCount: number;
}

/** The devices a person has turned notifications on for. */
export async function listDevices(db: Queryable, loginEmail: string): Promise<DeviceInfo[]> {
  const rows = await db.query(
    `SELECT id::int AS id, user_agent, created_at, last_seen_at, failed_count FROM push_subscription WHERE login_email = $1::text ORDER BY last_seen_at DESC`,
    [loginEmail]
  );
  return rows.map((r) => ({ id: Number(r.id), userAgent: String(r.user_agent || ''), createdAt: String(r.created_at), lastSeenAt: String(r.last_seen_at), failedCount: Number(r.failed_count || 0) }));
}

/** Sends any message to every device one person has registered, saying what happened to each. */
export async function sendPushToLogin(
  db: Queryable,
  loginEmail: string,
  payload: PushPayload
): Promise<{ reached: number; devices: { id: number; ok: boolean; error?: string }[] }> {
  const subs = await db.query(`SELECT id::int AS id, endpoint, p256dh, auth FROM push_subscription WHERE login_email = $1::text`, [loginEmail]);
  const devices: { id: number; ok: boolean; error?: string }[] = [];
  for (const s of subs) {
    const r = await sendToDetailed(db, s as any, payload);
    devices.push({ id: Number(s.id), ...r });
  }
  return { reached: devices.filter((d) => d.ok).length, devices };
}
