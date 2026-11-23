/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ThreatListPage } from './threat-list-page';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>;

const renderPage = (props: Partial<ComponentProps<typeof ThreatListPage>> = {}) => render(
  <ThreatListPage
    pending={0}
    readerScopeUnresolved={false}
    catalogEmpty={false}
    emptyState={<p>empty card</p>}
    kpiBand={<p>kpi band</p>}
    uploadAction={<button type="button">Analyze new bundle</button>}
    backfillStatus={<p>backfill status</p>}
    {...props}
  >
    <p>threat table</p>
  </ThreatListPage>,
  { wrapper },
);

const header = (): HTMLElement => {
  const heading = screen.getByRole('heading', { level: 1, name: 'Threats' });
  const row = heading.parentElement?.parentElement;
  if (!row) {
    throw new Error('no page header');
  }
  return row;
};

describe('ThreatListPage', () => {
  it('puts the upload action and the backfill status in the page header', () => {
    renderPage();

    expect(header().contains(screen.getByRole('button', { name: 'Analyze new bundle' }))).toBe(true);
    expect(header().contains(screen.getByText('backfill status'))).toBe(true);
  });

  it('shows the KPI band and the list under the header', () => {
    renderPage();

    expect(screen.getByText('kpi band')).toBeTruthy();
    expect(screen.getByText('threat table')).toBeTruthy();
    expect(header().contains(screen.getByText('threat table'))).toBe(false);
  });

  it('counts the threats being processed in the header', () => {
    renderPage({ pending: 3 });

    const status = screen.getAllByRole('status').find((element) => element.textContent?.includes('3 threats being processed'));
    expect(status).toBeDefined();
    expect(header().contains(status ?? null)).toBe(true);
  });

  it('shows no processing status when nothing is pending', () => {
    renderPage({ pending: 0 });

    expect(screen.queryByText(/being processed/)).toBeNull();
  });

  it('reduces an empty catalogue to its title, the running statuses and the empty card', () => {
    renderPage({ catalogEmpty: true, pending: 0 });

    expect(screen.getByRole('heading', { level: 1, name: 'Threats' })).toBeTruthy();
    expect(screen.getByText('empty card')).toBeTruthy();
    expect(header().contains(screen.getByText('backfill status'))).toBe(true);
    expect(screen.queryByText('kpi band')).toBeNull();
    expect(screen.queryByText('threat table')).toBeNull();
    expect(screen.queryByText(/being processed/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Analyze new bundle' })).toBeNull();
  });

  it('says some threats may be hidden when OpenCTI did not answer for the reader', () => {
    renderPage({ readerScopeUnresolved: true });

    expect(screen.getByText('Some threats may be hidden from you.')).toBeTruthy();
    expect(screen.getByText('threat table')).toBeTruthy();
  });

  it('says nothing about hidden threats when the reader scope is known', () => {
    renderPage({ readerScopeUnresolved: false });

    expect(screen.queryByText('Some threats may be hidden from you.')).toBeNull();
  });

  it('warns on an empty catalogue too, instead of leaving "start with the threats" alone', () => {
    renderPage({ catalogEmpty: true, readerScopeUnresolved: true });

    expect(screen.getByText('Some threats may be hidden from you.')).toBeTruthy();
    expect(screen.getByText('empty card')).toBeTruthy();
  });

  it('keeps the processing status in the header of an empty catalogue', () => {
    renderPage({ catalogEmpty: true, pending: 2 });

    const status = screen.getAllByRole('status').find((element) => element.textContent?.includes('2 threats being processed'));
    expect(status).toBeDefined();
    expect(header().contains(status ?? null)).toBe(true);
  });
});
