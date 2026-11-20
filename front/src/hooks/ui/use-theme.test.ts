/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../../providers/theme-provider';
import { createTrpcTestClient, NEVER, TrpcTestProviders } from '../../providers/trpc-test-harness';

// Prevent userPreferenceCollection from subscribing to localStorage in tests.
vi.mock('@tanstack/react-db', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-db')>();
  return { ...actual, useLiveQuery: () => ({ data: undefined }) };
});

describe('useTheme', () => {
  it('should return the correct effectiveTheme and update on system change', () => {
    let listener: (event: { matches: boolean }) => void;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (event: string, cb: (e: { matches: boolean }) => void) => {
          if (event === 'change') {
            listener = cb;
          }
        },
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    // The theme queries never answer, so the provider stays on the system theme.
    const { trpcClient } = createTrpcTestClient({ isLoggedIn: NEVER, 'users.getUserTheme': NEVER });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(TrpcTestProviders, { trpcClient, children: createElement(ThemeProvider, null, children) });

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.effectiveTheme).toBe('light');

    act(() => {
      listener({ matches: true });
    });
    expect(result.current.effectiveTheme).toBe('dark');

    act(() => {
      listener({ matches: false });
    });
    expect(result.current.effectiveTheme).toBe('light');
  });
});
