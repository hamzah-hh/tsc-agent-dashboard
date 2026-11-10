import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'tsc_theme';

/** Dark is the default; a person's choice is remembered on this device. */
export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

let current: Theme = typeof window === 'undefined' ? 'dark' : getInitialTheme();
const listeners = new Set<() => void>();

export function applyTheme(theme: Theme = current) {
  current = theme;
  if (typeof window === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => 'dark' as Theme,
  );
  return {
    theme,
    isDark: theme === 'dark',
    toggleTheme: () => applyTheme(current === 'dark' ? 'light' : 'dark'),
    setTheme: (t: Theme) => applyTheme(t),
  };
}
