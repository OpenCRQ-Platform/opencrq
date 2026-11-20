/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MatchingOutcomeRow } from './matching-outcome-table';
import { MatchingOutcomeTable } from './matching-outcome-table';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const linkTo = (href: string) => (name: string): ReactNode => createElement('a', { href }, name);

const rows: Array<MatchingOutcomeRow> = [
  { key: 'analysis-1', name: 'PhantomLocker', score: 0.9, badge: createElement('span', null, 'Intrusion set'), renderLink: linkTo('/threats/analysis-1') },
  { key: 'analysis-2', name: 'QuietFerret', score: 0, renderLink: linkTo('/threats/analysis-2') },
];

const renderTable = () => render(
  createElement(MatchingOutcomeTable, { entityColumnLabel: 'Threat', ariaLabel: 'Matching threats', rows }),
  { wrapper: ({ children }: { children: ReactNode }) => createElement(I18nProvider, { i18n }, children) },
);

describe('MatchingOutcomeTable', () => {
  it('leads every row to its own page, whatever its figure', () => {
    renderTable();

    expect(screen.getByRole('link', { name: 'PhantomLocker' }).getAttribute('href')).toBe('/threats/analysis-1');
    expect(screen.getByRole('link', { name: 'QuietFerret' }).getAttribute('href')).toBe('/threats/analysis-2');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the badge out of the link and shows each row\'s probability', () => {
    renderTable();

    expect(screen.getByText('Intrusion set').closest('a')).toBeNull();
    expect(screen.getByText('90%')).toBeTruthy();
  });
});
