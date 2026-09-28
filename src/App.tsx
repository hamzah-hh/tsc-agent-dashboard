import React, { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { auth, googleProvider } from './shared/firebase-client';
import { AgentView } from './components/AgentView';
import { StaffPortal } from './components/StaffPortal';
import { LogIn, LogOut, ShieldAlert, Layers, AlertCircle, RefreshCw, Volume2, VolumeX, Sparkles, Sun, Moon } from 'lucide-react';
import { soundFx } from './utils/audio';
import { fireGoldenCelebration } from './utils/confetti';
import { FestiveAura } from './components/FestiveAura';
import { useTheme } from './utils/theme';

interface SessionData {
  email: string;
  role: 'superAdmin' | 'manager' | 'tl' | 'agent' | null;
  officialEmail?: string;
  name?: string;
  location?: string;
  activeCycleId?: string;
  activeCycleName?: string;
  testMode?: boolean;
}

export default function App() {
  const { isDark, toggleTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(soundFx.enabled);
  // A server problem (for example the database is not reachable) is not the same as "no access"
  const [sessionProblem, setSessionProblem] = useState<string | null>(null);

  const loadSession = async (currentUser: User) => {
    setCheckLoading(true);
    setSessionProblem(null);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/auth/session', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data: SessionData = await res.json();
        setSession(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        setSession({ email: currentUser.email || '', role: null });
        if (res.status === 403) {
          // Signed in, but this email has no access
          if (errData?.error) setLoginError(errData.error);
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

  const handleLogin = async () => {
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.warn('Sign-in note:', err?.code, err?.message);
      if (err?.code === 'auth/popup-closed-by-user') {
        setLoginError('Sign-in window was closed before completion. Click below to try again.');
      } else if (err?.code === 'auth/cancelled-popup-request') {
        setLoginError(null);
      } else if (err?.code === 'auth/popup-blocked') {
        setLoginError('Pop-up was blocked by your browser. Please allow pop-ups for this page and try again.');
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
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-amber-500 dark:border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Loading TSC Incentive Portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans relative selection:bg-amber-500/20 selection:text-amber-900 dark:selection:text-amber-200 transition-colors duration-200">
      <FestiveAura />
      
      {/* Top Creator Attribution Banner */}
      <div className="bg-slate-900 text-slate-300 dark:bg-black dark:text-slate-400 text-xs py-1.5 px-4 border-b border-slate-800 text-center tracking-wide flex items-center justify-center gap-1.5 font-medium z-40 relative">
        <span>Created by <strong className="text-amber-400 font-semibold">Hamza Agha</strong>, with <strong className="text-white font-semibold">Gemini</strong></span>
      </div>

      {/* Top Navigation */}
      <header className="bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 sticky top-0 z-30 shadow-xs transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-15 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-950 dark:bg-slate-900 border border-transparent dark:border-slate-700 flex items-center justify-center text-white font-mono font-bold text-xs tracking-wider shadow-xs ring-1 ring-amber-500/30">
              TSC
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-slate-950 dark:text-white">
                Incentive Portal
              </span>
              <span className="text-slate-300 dark:text-slate-700 text-xs" aria-hidden="true">·</span>
              {session?.activeCycleName && (
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                  {session.activeCycleName}
                </span>
              )}
              <span className="text-slate-300 dark:text-slate-700 text-xs hidden lg:inline" aria-hidden="true">·</span>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hidden lg:inline">
                Created by Hamza Agha, with Gemini
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Audio Toggle & Theme Toggle & Quick Celebrate */}
            <div className="flex items-center gap-1.5 border-r border-slate-200/80 dark:border-slate-800 pr-3">
              <button
                onClick={() => {
                  fireGoldenCelebration();
                }}
                title="Celebrate your payout"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 border border-amber-200/80 dark:border-amber-500/30 rounded-lg transition active:scale-95 shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-subtle-sparkle" />
                <span className="hidden sm:inline font-mono">Celebrate</span>
              </button>

              {/* Premium Dark Mode Toggle with persistence */}
              <button
                onClick={toggleTheme}
                type="button"
                role="switch"
                aria-checked={isDark}
                title={isDark ? 'Current: Deep Slate-950 Dark Theme · Click for Light Mode' : 'Current: Light Theme · Click for Deep Slate-950 Dark Mode'}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 border bg-slate-100 hover:bg-slate-200/80 text-slate-700 border-slate-200/80 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-800 shadow-xs focus:outline-none focus:ring-2 focus:ring-amber-500/40 active:scale-95"
              >
                <div className="relative flex items-center justify-center">
                  {isDark ? (
                    <Moon className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20 transition-transform duration-200 group-hover:-rotate-12" />
                  ) : (
                    <Sun className="w-3.5 h-3.5 text-amber-600 fill-amber-600/20 transition-transform duration-200 group-hover:rotate-45" />
                  )}
                </div>
                <span className="hidden sm:inline font-mono text-[11px] font-semibold tracking-tight">
                  {isDark ? 'Dark' : 'Light'}
                </span>
                <span
                  className={`hidden sm:inline-block w-1.5 h-1.5 rounded-full transition-colors ${
                    isDark ? 'bg-amber-400 ring-2 ring-amber-400/20 animate-pulse' : 'bg-slate-400'
                  }`}
                  aria-hidden="true"
                />
              </button>

              <button
                onClick={() => {
                  const next = soundFx.toggle();
                  setSoundEnabled(next);
                }}
                title={soundEnabled ? 'Mute Sound FX' : 'Enable Sound FX'}
                className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>

            {user ? (
              <div className="flex items-center gap-3.5">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                    {session?.name || user.email}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-tight mt-0.5">
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-lg transition"
                >
                  <LogOut className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
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
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!user ? (
          // Logged Out Minimal Landing
          <div className="max-w-md mx-auto my-12 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-xl text-center">
            <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-center text-amber-500 mx-auto mb-4">
              <Layers className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1 tracking-tight">
              TSC Agent Incentive System
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Sign in with your authorized Google Account to view your actual incentive progress, unlock higher classes, or simulate targets.
            </p>

            {loginError && (
              <div className="mb-5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-left flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
                  {loginError}
                </div>
              </div>
            )}

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
          <div className="max-w-md mx-auto my-12 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border border-amber-200 dark:border-amber-900/50 rounded-2xl p-8 shadow-xl text-center">
            <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/50 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400 mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">The portal could not check your access</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
              This is a problem on our side, not with your account. Please try again in a minute.
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono break-words mb-6">{sessionProblem}</p>
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
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-bold rounded-xl shadow transition"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          // 5. No match -> show "Access denied. Contact your TL." and a Sign out button.
          <div className="max-w-md mx-auto my-12 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border border-rose-200 dark:border-rose-900/50 rounded-2xl p-8 shadow-xl text-center">
            <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 rounded-xl flex items-center justify-center text-rose-600 dark:text-rose-400 mx-auto mb-4">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">Access denied</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-5">
              Access denied. Contact your TL.
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-6">
              Logged in as <span className="font-mono text-slate-700 dark:text-slate-300">{user.email}</span>. Your account is not mapped in the incentive access database.
            </p>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-bold rounded-xl shadow transition"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm py-4 text-center text-[11px] text-slate-400 dark:text-slate-500 font-mono transition-colors duration-200">
        TSC Agent Incentive Portal{session?.activeCycleName ? <> &bull; {session.activeCycleName} Cycle</> : null}
      </footer>
    </div>
  );
}
