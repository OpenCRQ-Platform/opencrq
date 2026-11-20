/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeclaredEstateComparisonChart } from './declared-estate-utils';
import { DeclaredEstateComparisonCard } from './declared-estate-comparison-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>;

const viewport = (short: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: short,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

const chart: DeclaredEstateComparisonChart = {
  rows: [
    { category: 'host', measured: 12, bounds: null, partial: false },
    { category: 'identity', measured: 8, bounds: null, partial: false },
    { category: 'network_device', measured: 4, bounds: null, partial: false },
    { category: 'web_application', measured: 2, bounds: null, partial: false },
  ],
  largest: 12,
  declares: false,
};

describe('DeclaredEstateComparisonCard', () => {
  it('should render only the first rows on a short viewport, behind Show all categories', () => {
    viewport(true);
    render(<DeclaredEstateComparisonCard chart={chart} declaredAt={null} shortViewportRows={3} />, { wrapper });

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Show all categories' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('should show every row once expanded, and collapse them again', () => {
    viewport(true);
    render(<DeclaredEstateComparisonCard chart={chart} declaredAt={null} shortViewportRows={3} />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Show all categories' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer categories' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('should render every row and no toggle on a tall viewport', () => {
    viewport(false);
    render(<DeclaredEstateComparisonCard chart={chart} declaredAt={null} shortViewportRows={3} />, { wrapper });

    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Show all categories' })).toBeNull();
  });

  it('should offer no toggle when every row fits, or without a short-viewport count', () => {
    viewport(true);
    const { unmount } = render(<DeclaredEstateComparisonCard chart={chart} declaredAt={null} shortViewportRows={4} />, { wrapper });
    expect(screen.queryByRole('button', { name: 'Show all categories' })).toBeNull();
    unmount();

    render(<DeclaredEstateComparisonCard chart={chart} declaredAt={null} />, { wrapper });
    expect(screen.queryByRole('button', { name: 'Show all categories' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});
