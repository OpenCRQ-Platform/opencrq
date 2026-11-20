/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { formatDate } from '../../../utils/date-utils';
import { ThreatOutcomesTable } from './threat-outcomes-table';

type Outcome = { attackOutcomeId: string, outcomeName: string, score: number | null, judgedOn: string | null };

// The real Link needs a router; an anchor on the outcome id is enough to read where it points.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  const Link = ({ children, params, className }: { children: ReactNode, params?: { attackOutcomeId?: string }, className?: string }) =>
    createElement('a', { href: `/attack-outcomes/${params?.attackOutcomeId}`, className }, children);
  return { ...actual, Link };
});

const outcome = (index: number, score: number): Outcome => ({
  attackOutcomeId: `o${index}`,
  outcomeName: `Outcome ${String(index).padStart(2, '0')}`,
  score,
  judgedOn: null,
});

const OUTCOMES: Array<Outcome> = [
  { attackOutcomeId: 'o1', outcomeName: 'Ransomware', score: 0.27, judgedOn: null },
  { attackOutcomeId: 'o2', outcomeName: 'Customer data exfiltration', score: 0.82, judgedOn: null },
  { attackOutcomeId: 'o3', outcomeName: 'OT sabotage', score: 0, judgedOn: null },
];

const renderTable = (outcomes: Array<Outcome> = OUTCOMES) => renderWithTrpc(<ThreatOutcomesTable analysisId="a1" />, {
  answers: { 'threats.getOutcomeScoresForAnalysis': outcomes },
});

const searchFor = (text: string): void => {
  const field = screen.getByRole('searchbox', { name: 'Search for an attack outcome' });
  fireEvent.change(field, { target: { value: text } });
  fireEvent.blur(field);
};

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ThreatOutcomesTable', () => {
  it('lists the matched outcomes and offers the unmatched ones on demand', async () => {
    renderTable();

    expect(await screen.findByText('Customer data exfiltration')).toBeTruthy();
    expect(screen.getByText('Ransomware')).toBeTruthy();
    expect(screen.queryByText('OT sabotage')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show the 1 outcome with no match' }));

    expect(screen.getByText('OT sabotage')).toBeTruthy();
  });

  it('leads each outcome to its own page and marks the ones the threat weighs on', async () => {
    renderTable();

    expect((await screen.findByRole('link', { name: 'Customer data exfiltration' })).getAttribute('href')).toBe('/attack-outcomes/o2');
    expect(screen.getAllByText('Weighs on')).toHaveLength(1);
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says once, with its date, that a judged threat\'s percentages were judged', async () => {
    renderTable(OUTCOMES.map((item) => ({ ...item, judgedOn: '2026-11-02' })));

    expect(await screen.findByText(`Judged by OpenCRQ on ${formatDate('2026-11-02')}`)).toBeTruthy();
    expect(screen.getAllByText(/Judged by OpenCRQ/)).toHaveLength(1);
  });

  it('says nothing when a judgment left some outcomes to the counter', async () => {
    renderTable(OUTCOMES.map((item, index) => ({ ...item, judgedOn: index === 0 ? null : '2026-11-02' })));

    await screen.findByText('Customer data exfiltration');
    expect(screen.queryByText(/Judged by OpenCRQ/)).toBeNull();
  });

  it('says nothing about judgment on a threat the counter scored', async () => {
    renderTable();

    await screen.findByText('Customer data exfiltration');
    expect(screen.queryByText(/Judged by OpenCRQ/)).toBeNull();
  });

  it('says a threat without enough evidence has no percentage to show', async () => {
    renderTable([{ attackOutcomeId: 'o1', outcomeName: 'Ransomware', score: null, judgedOn: null }]);

    expect(await screen.findByText('Not enough data on this threat to assess its attack outcomes.')).toBeTruthy();
    expect(screen.queryByText('Ransomware')).toBeNull();
  });

  it('pages 25 outcomes by 20 and narrows them with a search', async () => {
    renderTable(Array.from({ length: 25 }, (_, index) => outcome(index + 1, (100 - index) / 100)));

    expect(await screen.findByText('Outcome 01')).toBeTruthy();
    expect(screen.getByText('Outcome 20')).toBeTruthy();
    expect(screen.queryByText('Outcome 21')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));

    expect(screen.queryByText('Outcome 01')).toBeNull();
    expect(screen.getByText('Outcome 21')).toBeTruthy();
    expect(screen.getByText('Outcome 25')).toBeTruthy();

    searchFor('outcome 2');

    expect(screen.getByText('6 entities')).toBeTruthy();

    expect(screen.getAllByRole('link', { name: /^Outcome \d{2}$/ }).map((link) => link.textContent))
      .toEqual(['Outcome 20', 'Outcome 21', 'Outcome 22', 'Outcome 23', 'Outcome 24', 'Outcome 25']);
  });

  it('says when a search only finds the outcomes held back', async () => {
    renderTable();
    await screen.findByText('Ransomware');

    searchFor('sabotage');

    expect(screen.getByText('This search only finds outcomes this threat does not match.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the 1 outcome with no match' })).toBeTruthy();
  });

  it('says when the tenant defines no attack outcome', async () => {
    renderTable([]);

    expect(await screen.findByText('No attack outcome defined for this tenant.')).toBeTruthy();
  });
});
