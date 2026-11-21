import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { rosterApi } from '../utils/rosterApi';

type State = 'checking' | 'hidden' | 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';

const keyBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * "Notifications on this device": turns web push on or off for the signed-in person. It stays out of sight
 * until the server has push set up, and says plainly when a browser (or an iPhone not yet added to the home
 * screen) cannot receive them.
 */
export function PushToggle({ getIdToken, className = '' }: { getIdToken: () => Promise<string>; className?: string }) {
  const [state, setState] = useState<State>('checking');
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const refresh = useCallback(async () => {
    try {
      const cfg = await rosterApi<{ enabled: boolean; publicKey: string }>(getIdToken, 'GET', '/api/push/config');
      if (!cfg.enabled) return setState('hidden');
      setPublicKey(cfg.publicKey);
      if (!supported) {
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const installed = (navigator as any).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
        return setState(ios && !installed ? 'ios-install' : 'unsupported');
      }
      if (Notification.permission === 'denied') return setState('blocked');
      const reg = await navigator.serviceWorker.register('/sw.js');
      const existing = await reg.pushManager.getSubscription();
      if (existing && Notification.permission === 'granted') {
        // Keep the server's copy fresh (it also learns the person's current inbox)
        await rosterApi(getIdToken, 'POST', '/api/push/subscribe', { subscription: existing.toJSON() }).catch(() => undefined);
        return setState('on');
      }
      setState('off');
    } catch {
      setState('hidden');
    }
  }, [getIdToken, supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const turnOn = async () => {
    setBusy(true);
    setNote('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await rosterApi<{ receives: boolean }>(getIdToken, 'POST', '/api/push/subscribe', { subscription: sub.toJSON() });
      if (!res.receives) setNote('Turned on. Roster alerts go to agents and team leaders.');
      setState('on');
    } catch (err: any) {
      setNote(err?.message || 'Could not turn notifications on.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setNote('');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await rosterApi(getIdToken, 'POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const r = await rosterApi<{ reached: number }>(getIdToken, 'POST', '/api/push/test', {});
      setNote(r.reached > 0 ? 'Test sent. It should arrive in a moment.' : 'No device was reached. Turn notifications off and on again.');
    } catch (err: any) {
      setNote(err?.message || 'Could not send the test.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'checking' || state === 'hidden') return null;

  const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 dark:border-line bg-slate-50/70 dark:bg-raised px-3 py-2 text-xs ${className}`}>
      {state === 'on' ? <Bell className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <BellOff className="w-4 h-4 text-slate-400 shrink-0" />}
      <span className="text-slate-700 dark:text-fg-2 flex-1 min-w-[12rem]">
        {state === 'on' && 'Notifications are on for this device.'}
        {state === 'off' && 'Get roster updates on this device, even when the dashboard is closed.'}
        {state === 'blocked' && 'Notifications are blocked for this site. Allow them in the browser settings, then come back.'}
        {state === 'unsupported' && 'This browser cannot receive notifications.'}
        {state === 'ios-install' && 'On iPhone: tap Share, then "Add to Home Screen", and open the dashboard from there to turn notifications on.'}
        {note && <span className="block text-slate-500 dark:text-slate-400 mt-0.5">{note}</span>}
      </span>
      {state === 'off' && (
        <button disabled={busy} onClick={turnOn} className={`${btn} bg-brand-900 text-white dark:bg-accent dark:text-on-accent`}>
          Turn on
        </button>
      )}
      {state === 'on' && (
        <>
          <button disabled={busy} onClick={sendTest} className={`${btn} border border-slate-300 dark:border-line text-slate-700 dark:text-fg-2`}>
            Send a test
          </button>
          <button disabled={busy} onClick={turnOff} className={`${btn} text-slate-500 hover:underline`}>
            Turn off
          </button>
        </>
      )}
    </div>
  );
}
