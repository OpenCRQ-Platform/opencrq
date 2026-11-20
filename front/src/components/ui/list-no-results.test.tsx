/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ListNoResults } from './list-no-results';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>;

describe('ListNoResults', () => {
  it('should say nothing matched and clear the search and filters', () => {
    const onClearFilters = vi.fn();
    render(<ListNoResults onClearFilters={onClearFilters} />, { wrapper });

    expect(screen.getByText('No results')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});
