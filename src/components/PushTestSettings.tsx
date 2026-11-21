import React, { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { RosterApiError, rosterApi } from '../utils/rosterApi';
import { PushToggle } from './PushToggle';

interface Device {
  id: number;
  userAgent: string;
  lastSeenAt: string;
  failedCount: number;
}
interface Status {
  configured: boolean;
  devices: Device[];
}

const deviceName = (ua: string) => {
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iPhone / iPad' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
};

/** Super Admin: turn notifications on for this device and send a test message to every device on this account. */
export function PushTestSettings({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [title, setTitle] = useState('Test notification');
  const [body, setBody] = useState('This is a test from the Super Admin panel.');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await rosterApi<Status>(getIdToken, 'GET', '/api/admin/push/status'));
    } catch {
      setStatus(null);
    }
  }, [getIdToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await rosterApi<{ reached: number; devices: { ok: boolean; error?: string }[] }>(getIdToken, 'POST', '/api/admin/push/test', { title, body });
      const failed = out.devices.filter((d) => !d.ok);
      if (!out.devices.length) setMsg({ ok: false, text: 'No device is registered on this account. Use Turn on above, on the device you want to test.' });
      else if (!failed.length) setMsg({ ok: true, text: `Sent to ${out.reached} device${out.reached === 1 ? '' : 's'}. It should arrive in a moment.` });
      else setMsg({ ok: false, text: `Reached ${out.reached} of ${out.devices.length}. Failed: ${failed.map((d) => d.error).join('; ')}` });
      void load();
    } catch (err: any) {
      setMsg({ ok: false, text: err instanceof RosterApiError ? err.message : 'Could not send.' });
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full max-w-md border border-slate-300 dark:border-line bg-white dark:bg-panel text-slate-800 dark:text-fg rounded-lg px-3 py-2 text-xs';
  const label = 'block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1';
  return (
    <div className="bg-white dark:bg-panel border border-slate-200 dark:border-line rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <BellRing className="w-4 h-4 text-accent" />
        <h3 className="text-xs font-bold text-slate-800 dark:text-fg uppercase tracking-wider">Test notifications</h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Turn notifications on for the device you are using, then send yourself a message. It goes to every device registered on this account.
      </p>

      {status && !status.configured && (
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-3">
          Not set up on the server yet: add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel, then redeploy.
        </p>
      )}

      <PushToggle getIdToken={getIdToken} className="mb-4 max-w-xl" />

      <div className="space-y-3">
        <div>
          <label htmlFor="push-title" className={label}>
            Title
          </label>
          <input id="push-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="push-body" className={label}>
            Message
          </label>
          <textarea id="push-body" rows={2} value={body} maxLength={200} onChange={(e) => setBody(e.target.value)} className={field} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={send} disabled={busy || (status ? !status.configured : false)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-900 text-white dark:bg-accent dark:text-on-accent disabled:opacity-50">
          {busy ? 'Sending...' : 'Send to my devices'}
        </button>
        {msg && <span className={`text-xs font-semibold ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{msg.text}</span>}
      </div>

      {status && (
        <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="font-semibold text-slate-700 dark:text-fg-2 mb-1">
            Devices on this account: {status.devices.length}
          </div>
          {status.devices.map((d) => (
            <div key={d.id}>
              {deviceName(d.userAgent)}, last seen {new Date(d.lastSeenAt).toLocaleString()}
              {d.failedCount > 0 ? `, ${d.failedCount} failed ${d.failedCount === 1 ? 'send' : 'sends'}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
