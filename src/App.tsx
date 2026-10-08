import React, { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth, googleProvider } from './shared/firebase-client';
import { setCachedSheetsToken } from './shared/sheets-auth';
import { AgentView } from './components/AgentView';
import { StaffPortal } from './components/StaffPortal';
import { LogIn, LogOut, ShieldAlert, Layers, AlertCircle, RefreshCw, Volume2, VolumeX, Clock, Timer } from 'lucide-react';
import { soundFx } from './utils/audio';
import { FestiveAura } from './components/FestiveAura';
import { useTheme } from './utils/theme';
import { AgentLoginSessionState } from './shared/types';

interface SessionData {
  email: string;
  role: 'superAdmin' | 'manager' | 'tl' | 'agent' | null;
  officialEmail?: string;
  name?: string;
  location?: string;
  activeCycleId?: string;
  activeCycleName?: string;
  testMode?: boolean;
  loginTracker?: AgentLoginSessionState;
}

export default function App() {
  useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(soundFx.enabled);
  // A server problem (for example the database is not reachable) is not the same as "no access"
  const [sessionProblem, setSessionProblem] = useState<string | null>(null);

  // Login tracker countdown state
  const [trackerState, setTrackerState] = useState<AgentLoginSessionState | null>(null);
  const [timeExhaustedNotice, setTimeExhaustedNotice] = useState<{
    message: string;
    windowId: 'AM' | 'PM';
    nextWindowOpensAt?: string;
  } | null>(null);

  const loadSession = async (currentUser: User) => {
    setCheckLoading(true);
    setSessionProblem(null);
    try {
      const token = await currentUser.getIdToken();
      let res: Response | null = null;

      // Handle momentary server restarts or connection hiccups with automatic retries
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch('/api/auth/session', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (res) break;
        } catch (fetchErr: any) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          throw fetchErr;
        }
      }

      if (!res) throw new Error('No response from server');

      if (res.ok) {
        const data: SessionData = await res.json();
        setSession(data);
        if (data.role === 'agent' && data.loginTracker) {
          setTrackerState(data.loginTracker);
          setTimeExhaustedNotice(null);
        } else {
          setTrackerState(null);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setSession({ email: currentUser.email || '', role: null });
        if (res.status === 403) {
          // Signed in, but this email has no access or time is exhausted
          if (errData?.error) setLoginError(errData.error);
          if (errData?.timeExhausted) {
            setTimeExhaustedNotice({
              message: errData.error,
              windowId: errData.loginTracker?.windowId || 'AM',
              nextWindowOpensAt: errData.loginTracker?.nextWindowOpensAt || 'the next window',
            });
          }
        } else {
          setSessionProblem(errData?.error || `The server answered with HTTP ${res.status}.`);
        }
      }
    } catch (e: any) {
      console.error('Failed to verify session role:', e);
      setSession({ email: currentUser.email || '', role: null });
      setSessionProblem(e?.message || 'The server could not be reached.');
    } finally {
      setCheckLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setLoginError(null);
        await loadSession(currentUser);
      } else {
        setSession(null);
        setSessionProblem(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Login tracker countdown and heartbeats
  useEffect(() => {
    if (!user || session?.role !== 'agent' || !trackerState?.enabled) {
      return;
    }

    // 1. Local 1-second countdown timer
    const countdownTimer = setInterval(() => {
      setTrackerState((prev) => {
        if (!prev) return null;
        if (prev.remainingSeconds <= 1) {
          clearInterval(countdownTimer);
          // Auto-logout
          soundFx.playPop();
          handleLogout();
          setTimeExhaustedNotice({
            message: prev.reason || `Session Time Limit Reached: You have completed your ${prev.windowLimitMinutes}-minute access limit for the ${prev.windowId} window.`,
            windowId: prev.windowId,
            nextWindowOpensAt: prev.nextWindowOpensAt,
          });
          return { ...prev, remainingSeconds: 0, allowed: false };
        }
        return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
      });
    }, 1000);

    // 2. Periodic 20-second heartbeat to sync with server and accumulate used time
    const heartbeatTimer = setInterval(async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/agent/heartbeat', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const updated: AgentLoginSessionState = await res.json();
          if (!updated.allowed || updated.remainingSeconds <= 0) {
            clearInterval(heartbeatTimer);
            clearInterval(countdownTimer);
            handleLogout();
            setTimeExhaustedNotice({
              message: updated.reason || `Session Time Limit Reached: You have completed your ${updated.windowLimitMinutes}-minute access limit for the ${updated.windowId} window.`,
              windowId: updated.windowId,
              nextWindowOpensAt: updated.nextWindowOpensAt,
            });
          } else {
            setTrackerState(updated);
          }
        }
      } catch (err) {
        console.warn('Heartbeat failed:', err);
      }
    }, 20000);

    return () => {
      clearInterval(countdownTimer);
      clearInterval(heartbeatTimer);
    };
  }, [user, session?.role, trackerState?.enabled]);

  const handleLogin = async () => {
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setCachedSheetsToken(credential.accessToken);
      }
    } catch (err: any) {
      console.warn('Sign-in note:', err?.code, err?.message);
      if (err?.code === 'auth/popup-closed-by-user') {
        setLoginError('Sign-in window was closed before completion. Click below to try again.');
      } else if (err?.code === 'auth/cancelled-popup-request') {
        setLoginError(null);
      } else if (err?.code === 'auth/popup-blocked') {
        setLoginError('Pop-up was blocked by your browser. Please allow pop-ups for this page and try again.');
      } else if (err?.code === 'auth/unauthorized-domain') {
        setLoginError(
          `Domain "${window.location.hostname}" is not authorized for Google Sign-In in your Firebase project. Please add "${window.location.hostname}" to Firebase Console → Authentication → Settings → Authorized domains.`
        );
      } else if (err?.code === 'auth/operation-not-allowed') {
        setLoginError('Google Sign-In provider is not enabled in Firebase Console. Please enable it in Authentication → Sign-in method.');
      } else {
        setLoginError(err?.message || 'Sign-in could not be completed. Please try again.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCachedSheetsToken(null);
      setSession(null);
      setLoginError(null);
    } catch (err: any) {
      console.error('Sign-out error:', err);
    }
  };

  const getIdToken = async (): Promise<string> => {
    if (!auth.currentUser) throw new Error('Not logged in');
    return auth.currentUser.getIdToken(true);
  };

  if (authLoading || checkLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs font-semibold text-slate-600">Loading TSC Agent Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans relative selection:bg-amber-500/20 selection:text-amber-900">
      <FestiveAura />

      {/* Top Navigation */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-white font-mono font-bold text-xs tracking-wider shadow-xs ring-1 ring-amber-500/30">
              TSC
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-slate-950">
                Agent Dashboard
              </span>
              <span className="text-slate-300 text-xs" aria-hidden="true">·</span>
              {session?.activeCycleName && (
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-full font-mono">
                  {session.activeCycleName}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Audio Toggle (Accessible only when logged in) */}
            <div className="flex items-center gap-1.5 border-r border-slate-200 pr-3">
              <button
                onClick={() => {
                  const next = soundFx.toggle();
                  setSoundEnabled(next);
                }}
                title={soundEnabled ? 'Mute Sound FX' : 'Enable Sound FX'}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>

            {user ? (
              <div className="flex items-center gap-3">
                {session?.role === 'agent' && trackerState && trackerState.enabled && (
                  <div
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold border transition duration-300 shadow-xs shrink-0 ${
                      trackerState.remainingSeconds < 180
                        ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse'
                        : trackerState.remainingSeconds < 600
                        ? 'bg-amber-50 text-amber-700 border-amber-300'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    }`}
                    title={`Your remaining login time in this ${trackerState.windowId} window. Next access window opens at ${trackerState.nextWindowOpensAt || ''}`}
                  >
                    <Clock className="w-3.5 h-3.5 animate-spin-slow" />
                    <span>
                      {trackerState.windowId}: {Math.floor(trackerState.remainingSeconds / 60)}m {trackerState.remainingSeconds % 60}s
                    </span>
                  </div>
                )}

                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-xs font-semibold text-slate-900 leading-tight">
                    {session?.name || user.email}
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">
                    {session?.role === 'superAdmin'
                      ? 'Super Admin'
                      : session?.role === 'manager'
                      ? 'Manager'
                      : session?.role === 'tl'
                      ? `Team Leader · ${session.location || ''}`
                      : session?.role === 'agent'
                      ? `Caller · ${session.location || ''}`
                      : 'Authorized User'}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition"
                >
                  <LogOut className="w-3.5 h-3.5 text-slate-500" />
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                {isLoggingIn ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <LogIn className="w-3.5 h-3.5" />
                    Google Sign-In
                  </>
                )}
              </button>
            )}

            {/* Official The Sleep Company Logo in Top Right */}
            <div className="flex items-center pl-3 border-l border-slate-200">
              <img
                src="https://thesleepcompany.in/cdn/shop/files/new_logo.webp?v=1706780127&width=600"
                alt="The Sleep Company"
                className="h-8 sm:h-9 w-auto object-contain max-w-[150px] sm:max-w-[170px]"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!user ? (
          // Logged Out Minimal Landing
          <div className="max-w-md mx-auto my-12 bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-8 shadow-xl text-center">
            <img
              src="https://thesleepcompany.in/cdn/shop/files/new_logo.webp?v=1706780127&width=600"
              alt="The Sleep Company"
              className="h-10 w-auto object-contain mx-auto mb-4"
            />
            <h2 className="text-lg font-bold text-slate-900 mb-1 tracking-tight">
              Agent Dashboard
            </h2>
            <p className="text-xs text-slate-600 mb-6 leading-relaxed">
              Sign in with your authorized Google Account to view your actual incentive progress, unlock higher classes, or simulate targets.
            </p>

            {timeExhaustedNotice ? (
              <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-left flex items-start gap-3 shadow-xs">
                <Timer className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-rose-900 mb-0.5 uppercase tracking-wide">
                    ⏱️ Session Time Limit Reached ({timeExhaustedNotice.windowId} Window)
                  </h4>
                  <p className="text-xs text-rose-800 leading-relaxed font-medium">
                    {timeExhaustedNotice.message}
                  </p>
                </div>
              </div>
            ) : loginError ? (
              <div className="mb-5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-left flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 leading-relaxed font-medium">
                  {loginError}
                </div>
              </div>
            ) : null}

            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-60 transition active:scale-95"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Opening Google Sign-In...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign in with Google
                </>
              )}
            </button>
          </div>
        ) : session?.role === 'agent' ? (
          // Agent View: opens own record directly
          <AgentView
            officialEmail={session.officialEmail || ''}
            getIdToken={getIdToken}
          />
        ) : session?.role === 'superAdmin' ||
          session?.role === 'manager' ||
          session?.role === 'tl' ? (
          // Staff Portal with Team, Leaderboards, Sync Status, and Test Center
          <StaffPortal
            userRole={session.role}
            userEmail={user.email || ''}
            userLocation={session.location}
            activeCycleId={session.activeCycleId || 'diwali-2026'}
            cycleName={session.activeCycleName}
            testMode={session.testMode}
            getIdToken={getIdToken}
          />
        ) : sessionProblem ? (
          // The server could not check the access (not the same as "no access"): say so and let the user retry
          <div className="max-w-md mx-auto my-12 bg-white/95 backdrop-blur-md border border-amber-200 rounded-2xl p-8 shadow-xl text-center">
            <div className="w-12 h-12 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-center text-amber-600 mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-1">The portal could not check your access</h2>
            <p className="text-xs text-slate-600 mb-3">
              This is a problem on our side, not with your account. Please try again in a minute.
            </p>
            <p className="text-[11px] text-slate-500 font-mono break-words mb-6">{sessionProblem}</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => user && loadSession(user)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow transition"
              >
                <RefreshCw className="w-4 h-4" />
                Try again
              </button>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow transition"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          // 5. No match -> show "Access denied. Contact your TL." and a Sign out button.
          <div className="max-w-md mx-auto my-12 bg-white/95 backdrop-blur-md border border-rose-200 rounded-2xl p-8 shadow-xl text-center">
            <div className="w-12 h-12 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-center text-rose-600 mx-auto mb-4">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Access denied</h2>
            <p className="text-xs text-slate-600 mb-5">
              Access denied. Contact your TL.
            </p>
            <p className="text-[11px] text-slate-400 mb-6">
              Logged in as <span className="font-mono text-slate-700">{user.email}</span>. Your account is not mapped in the incentive access database.
            </p>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow transition"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white/80 backdrop-blur-sm py-4 text-center text-[11px] text-slate-400 font-mono">
        The Sleep Company &bull; Agent Dashboard{session?.activeCycleName ? <> &bull; {session.activeCycleName} Cycle</> : null}
      </footer>
    </div>
  );
}
