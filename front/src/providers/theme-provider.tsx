import type { FunctionComponent, ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { userPreferenceCollection } from '../stores/user-preference-collection';

const themeValues = ['light', 'dark', 'system'] as const;
export type Theme = typeof themeValues[number];

export const getThemes = (): Array<{ value: Theme, label: string }> => [
  { value: 'light', label: t`Light` },
  { value: 'dark', label: t`Dark` },
  { value: 'system', label: t`System` },
];

type ThemeContextType = {
  theme: Theme,
  effectiveTheme: 'light' | 'dark',
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Both classes are managed explicitly: @filigran/design-system tokens treat the
 * absence of a class as dark, so light has to be opted into.
 */
const applyTheme = (theme: 'light' | 'dark') => {
  const { classList } = document.documentElement;
  classList.toggle('dark', theme === 'dark');
  classList.toggle('light', theme === 'light');
};

export const isValidTheme = (value: string | null): value is Theme =>
  value !== null && (themeValues as ReadonlyArray<string>).includes(value);

// eslint-disable-next-line lingui/no-unlocalized-strings
const getIsSystemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export const ThemeProvider: FunctionComponent<{ children: ReactNode }> = ({ children }) => {
  const trpc = useTRPC();
  const isLoggedInQuery = useQuery(trpc.isLoggedIn.queryOptions());
  const isEnabled = isLoggedInQuery.isSuccess && isLoggedInQuery.data !== null;

  const themeQuery = useQuery(trpc.users.getUserTheme.queryOptions(undefined, {
    enabled: isEnabled,
  }));
  const dbTheme = themeQuery.data;

  const { data: userPreference } = useLiveQuery({
    query: (q) =>
      q.from({ el: userPreferenceCollection })
        .where(({ el }) => eq(el.id, 'user-preference'))
        .findOne(),
  });

  // Sync dbTheme → collection
  useEffect(() => {
    if (dbTheme && isValidTheme(dbTheme)) {
      if (userPreferenceCollection.has('user-preference')) {
        userPreferenceCollection.update('user-preference', (draft) => {
          draft.theme = dbTheme;
        });
      } else {
        userPreferenceCollection.insert({ id: 'user-preference', theme: dbTheme, locale: '' });
      }
    }
  }, [dbTheme]);

  // Listener OS pour prefers-color-scheme (seul cas non couvert par la collection)
  const [isSystemDark, setIsSystemDark] = useState(getIsSystemDark);
  useEffect(() => {
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const theme: Theme = (() => {
    if (dbTheme && isValidTheme(dbTheme)) {
      return dbTheme;
    }
    if (userPreference?.theme && isValidTheme(userPreference.theme)) {
      return userPreference.theme;
    }
    return 'system';
  })();

  const effectiveTheme: 'light' | 'dark' = theme === 'system' ? (isSystemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    applyTheme(effectiveTheme);
  }, [effectiveTheme]);

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};
