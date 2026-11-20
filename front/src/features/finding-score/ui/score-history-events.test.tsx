/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ScoreHistoryLine } from '../score-history-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ScoreHistoryEvents } from './score-history-events';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const DAY_MS = 86_400_000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

const renderWith = (lines: Array<ScoreHistoryLine>) => {
  renderWithTrpc(<ScoreHistoryEvents evidenceId="finding" />, {
    answers: { 'findingScore.getFindingScoreHistory': lines },
  });
};

describe('ScoreHistoryEvents', () => {
  it('should list each move newest first, the first score last with its band and no points', async () => {
    renderWith([
      { at: daysAgo(60), score: 61, band: 'medium' },
      { at: daysAgo(30), score: 72, band: 'high' },
      { at: daysAgo(10), score: 70, band: 'high' },
    ]);

    const rows = (await screen.findAllByText(/^(Score moved|First score)/)).map((node) => node.textContent);
    expect(rows).toEqual(['Score moved from 72 to 70.−2 pts', 'Score moved from 61 to 72.+11 pts', 'First score: 61.']);
    expect(await screen.findByText('3 events')).toBeTruthy();
  });

  it('should name a band change on its own line, and nothing for a move inside a band', async () => {
    renderWith([
      { at: daysAgo(60), score: 61, band: 'medium' },
      { at: daysAgo(30), score: 72, band: 'high' },
      { at: daysAgo(10), score: 70, band: 'high' },
    ]);

    expect(await screen.findByText('Band Medium → High.')).toBeTruthy();
    expect(screen.getByText('Band Medium.')).toBeTruthy();
    expect(screen.queryByText('Band High → High.')).toBeNull();
  });

  it('should say a score held when only its band moved, with no points chip', async () => {
    renderWith([
      { at: daysAgo(60), score: 69, band: 'medium' },
      { at: daysAgo(30), score: 69, band: 'high' },
    ]);

    expect(await screen.findByText('Score held at 69.')).toBeTruthy();
    expect(screen.getByText('Band Medium → High.')).toBeTruthy();
  });

  it('should say a finding with no journal line has no history yet', async () => {
    renderWith([]);

    expect(await screen.findByText('No history yet.')).toBeTruthy();
  });
});
