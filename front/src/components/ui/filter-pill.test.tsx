/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FilterClearAll, FilterPill, FilterPillItem } from './filter-pill';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>;

describe('FilterPill', () => {
  it('should read its label alone while the filter is not set', () => {
    render(<FilterPill label="Source"><FilterPillItem>All sources</FilterPillItem></FilterPill>, { wrapper });

    const pill = screen.getByRole('button', { name: 'Source' });
    expect(pill.getAttribute('data-active')).toBeNull();
  });

  it('should read its label and its value once set, whole in its tooltip', () => {
    render(<FilterPill label="Category" valueLabel="Identity"><FilterPillItem>Identity</FilterPillItem></FilterPill>, { wrapper });

    const pill = screen.getByRole('button', { name: 'Category: Identity' });
    expect(pill.getAttribute('data-active')).toBe('true');
    expect(pill.getAttribute('title')).toBe('Category: Identity');
  });

  it('should read the whole text it is given once set, in place of "Label: value"', () => {
    render(
      <FilterPill label="Category" valueLabel="Identity" text="Category: except Identity"><FilterPillItem>Identity</FilterPillItem></FilterPill>,
      { wrapper },
    );

    const pill = screen.getByRole('button', { name: 'Category: except Identity' });
    expect(pill.getAttribute('title')).toBe('Category: except Identity');
  });

  it('should let a long value shrink inside the pill, so it is cut before the chevron', () => {
    render(<FilterPill label="Category" valueLabel="Container / Workload"><FilterPillItem>Container</FilterPillItem></FilterPill>, { wrapper });

    const pill = screen.getByRole('button', { name: 'Category: Container / Workload' });
    expect(pill.className).toContain('[&>span]:min-w-0');
    expect(screen.getByText('Category: Container / Workload').className).toContain('min-w-0');
  });
});

describe('FilterClearAll', () => {
  it('should draw nothing while no filter is set', () => {
    const { container } = render(<FilterClearAll count={0} onClearAll={vi.fn()} />, { wrapper });

    expect(container.childElementCount).toBe(0);
  });

  it('should count the filters set and lift them all', () => {
    const onClearAll = vi.fn();
    render(<FilterClearAll count={2} onClearAll={onClearAll} />, { wrapper });

    expect(screen.getByText('2 active filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });
});
