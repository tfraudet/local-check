import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ThemeContext,
  THEME_STORAGE_KEY,
  getPreferredTheme,
  type Theme,
} from '../hooks/useTheme';

/**
 * Provides the current light/dark theme and a way to toggle it. Applies
 * the `dark` class to `<html>` (consumed by the `@custom-variant dark`
 * rule in `index.css`) and persists the user's explicit choice so it
 * survives reloads.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getPreferredTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
