import { describe, expect, it } from 'vitest';
import type { UniqueFindingHistoryLine } from './unique-finding-events';
import { explainUniqueFindingEvents } from './unique-finding-events';

const line = (id: string, score: number | null, worstScore: number | null, affectedAssetCount: number | null): UniqueFindingHistoryLine => ({
  id,
  changedAt: new Date(`2026-0${id}-01T03:00:00Z`),
  score,
  band: score === null ? null : (score >= 70 ? 'high' : 'medium'),
  worstScore,
  affectedAssetCount,
});

const EVERYTHING = new Date(0);

describe('explainUniqueFindingEvents', () => {
  const newestFirst = [
    line('6', 80.15, 78.3, 120),
    line('5', 79.4, 78.3, 112),
    line('4', 69.9, 68.2, 112),
    line('3', 72.5, 71.1, 40),
    line('2', null, null, null),
    line('1', 66.2, 65.4, 18),
  ];

  it('names each move from the line before it', () => {
    const events = explainUniqueFindingEvents(newestFirst, null, EVERYTHING);

    expect(events.map((event) => event.kind)).toEqual(['rise', 'rise', 'fall', 'regained', 'lost', 'first']);
  });

  it('truncates every figure as a finding score is', () => {
    const [latest] = explainUniqueFindingEvents(newestFirst, null, EVERYTHING);

    expect(latest).toMatchObject({ score: 80, worstScore: 78, affectedAssetCount: 120 });
    expect(latest?.previous).toEqual({ score: 79, band: 'high', worstScore: 78, affectedAssetCount: 112 });
  });

  it('reads the oldest event of a page against the line just older than the page', () => {
    const events = explainUniqueFindingEvents(newestFirst.slice(0, 2), newestFirst[2], EVERYTHING);

    expect(events.at(-1)).toMatchObject({ kind: 'rise', previous: { score: 69, worstScore: 68 } });
  });

  it('gives the lost line no figures', () => {
    const lost = explainUniqueFindingEvents(newestFirst, null, EVERYTHING).find((event) => event.kind === 'lost');

    expect(lost).toMatchObject({ score: null, worstScore: null, affectedAssetCount: null, previous: { score: 66 } });
  });

  it('reads the line the trim kept before the retained span as the previous of the next event, never as a first score', () => {
    const events = explainUniqueFindingEvents(newestFirst, null, new Date('2026-01-15T00:00:00Z'));

    expect(events.map((event) => event.kind)).toEqual(['rise', 'rise', 'fall', 'regained', 'lost']);
    expect(events.at(-1)?.previous).toMatchObject({ score: 66 });
  });
});
