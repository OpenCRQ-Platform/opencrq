/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScoreHistoryLine } from '../score-history-utils';
import { formatDate } from '../../../utils';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<object>(),
  Link: ({ params, children }: { params: { evidenceId: string }, children: ReactNode }) => (
    <a href={`/findings/${params.evidenceId}/events`}>{children}</a>
  ),
}));

const { ScoreHistoryLifeline } = await import('./score-history-lifeline');

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const DAY_MS = 86_400_000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

const lines: Array<ScoreHistoryLine> = [
  { at: daysAgo(60), score: 61, band: 'medium' },
  { at: daysAgo(10), score: 78, band: 'high' },
];

const renderLifeline = (props: { lines: Array<ScoreHistoryLine> | undefined, withFigure?: boolean, isError?: boolean }) => render(
  <I18nProvider i18n={i18n}>
    <ScoreHistoryLifeline
      tenantId="tenant"
      evidenceId="finding"
      lines={props.lines}
      isError={props.isError ?? false}
      withFigure={props.withFigure ?? false}
      defaultWindow="90d"
    />
  </I18nProvider>,
);

describe('ScoreHistoryLifeline', () => {
  it('should read the move over the window from its first figure, with no score of its own', () => {
    renderLifeline({ lines });

    const firstDate = formatDate(new Date(lines[0].at));
    expect(screen.getByText(`since 61 on ${firstDate}`, { exact: false })).toBeTruthy();
    expect(screen.getByText('+17 pts')).toBeTruthy();
    expect(screen.queryByText('78')).toBeNull();
  });

  it('should print the current score and its band when it carries its figure', () => {
    renderLifeline({ lines, withFigure: true });

    expect(screen.getByText('78')).toBeTruthy();
    expect(screen.getByText(/out of 100 · High · 61 on/)).toBeTruthy();
  });

  it('should print the band the last line was journaled with', () => {
    renderLifeline({ lines: [{ at: daysAgo(60), score: 69, band: 'medium' }, { at: daysAgo(10), score: 69, band: 'high' }], withFigure: true });

    expect(screen.getByText(/out of 100 · High · 69 on/)).toBeTruthy();
  });

  it('should announce no move for a line only its band wrote', () => {
    renderLifeline({ lines: [{ at: daysAgo(60), score: 69, band: 'medium' }, { at: daysAgo(10), score: 69, band: 'high' }] });

    fireEvent.focus(screen.getByRole('group'));

    expect(screen.getByRole('status').textContent).toMatch(/Finding score 69\. Band Medium → High\.$/);
  });

  it('should announce the move and the band change of the mark the arrow keys reach', () => {
    renderLifeline({ lines });
    const plot = screen.getByRole('group');

    fireEvent.focus(plot);

    expect(screen.getByRole('status').textContent).toContain('+17 pts from 61. Band Medium → High.');
  });

  it('should say so in words when the window holds no score', () => {
    renderLifeline({ lines: [] });

    expect(screen.getByText('No finding score recorded over this period.')).toBeTruthy();
  });

  it('should link to the finding events tab', () => {
    renderLifeline({ lines });

    expect(screen.getByRole('link', { name: 'View events' }).getAttribute('href')).toBe('/findings/finding/events');
  });
});
