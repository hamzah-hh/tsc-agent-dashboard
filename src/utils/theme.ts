export type Theme = 'light';

export const THEME_STORAGE_KEY = 'tsc_theme';

export function getInitialTheme(): Theme {
  return 'light';
}

export function applyTheme(_theme?: Theme) {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('dark');
  document.body.classList.remove('dark');
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {}
}

export function useTheme() {
  applyTheme('light');

  return {
    theme: 'light' as const,
    isDark: false,
    toggleTheme: () => {},
    setTheme: () => {},
  };
}

