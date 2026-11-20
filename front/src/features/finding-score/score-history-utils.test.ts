import type { SeverityBand } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { ScoreHistoryLine, ScoreLifelineLine } from './score-history-utils';
import { buildScoreEvents, buildScoreLifeline, scoreEventBandMove, scoreEventPoints } from './score-history-utils';

const DAY_MS = 86_400_000;
const NOW = new Date(Date.UTC(2026, 9, 1, 12));

const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const line = (days: number, score: number, band: SeverityBand): ScoreHistoryLine => ({ at: daysAgo(days), score, band });

describe('buildScoreLifeline', () => {
  it('should return nothing for a finding with no journal line', () => {
    expect(buildScoreLifeline([], '90d', NOW)).toBeNull();
  });

  it('should read the move over the window from its first line to its last', () => {
    const lifeline = buildScoreLifeline([line(60, 61, 'medium'), line(30, 72, 'high'), line(10, 78, 'high')], '90d', NOW)!;

    expect(lifeline.values).toEqual([61, 72, 78]);
    expect(lifeline.oldest).toEqual({ at: new Date(daysAgo(60)), score: 61 });
    expect(lifeline.change).toBe(17);
  });

  it('should name the band a line crosses into, and none for a move inside a band', () => {
    const lifeline = buildScoreLifeline([line(60, 61, 'medium'), line(30, 72, 'high'), line(10, 78, 'high')], '90d', NOW)!;

    expect(lifeline.marks.map((mark) => mark.bandMove)).toEqual([null, { from: 'medium', to: 'high' }, null]);
    expect(lifeline.marks.map((mark) => mark.previous)).toEqual([null, 61, 72]);
  });

  it('should keep the band each line was journaled with rather than read it again off its score', () => {
    const lifeline = buildScoreLifeline([line(60, 69, 'medium'), line(30, 69, 'high')], '90d', NOW)!;

    expect(lifeline.marks.map((mark) => mark.band)).toEqual(['medium', 'high']);
    expect(lifeline.marks[1].bandMove).toEqual({ from: 'medium', to: 'high' });
    expect(lifeline.latestBand).toBe('high');
  });

  it('should open a shorter window on the line in force, so an older move still draws at its score', () => {
    const lifeline = buildScoreLifeline([line(300, 40, 'medium'), line(120, 55, 'medium')], '90d', NOW)!;

    expect(lifeline.single).toBe(true);
    expect(lifeline.values).toEqual([55, 55]);
    expect(lifeline.marks).toEqual([]);
  });

  it('should draw a single line flat across the plot', () => {
    const lifeline = buildScoreLifeline([line(5, 66, 'medium')], '12m', NOW)!;

    expect(lifeline.single).toBe(true);
    expect(lifeline.values).toEqual([66, 66]);
    expect(lifeline.change).toBe(0);
  });

  it('should break the curve while the score is lost, holding it up to the line that loses it', () => {
    const lines: Array<ScoreLifelineLine> = [line(60, 66, 'medium'), { at: daysAgo(40), score: null, band: null }, line(20, 72, 'high'), line(5, 69, 'medium')];

    const lifeline = buildScoreLifeline(lines, '90d', NOW)!;

    expect(lifeline.values).toEqual([66, 66, null, 72, 69]);
    expect(lifeline.marks.map((mark) => [mark.score, mark.previous])).toEqual([[66, null], [null, 66], [72, null], [69, 72]]);
    expect(lifeline.marks[1].line).toBe(lines[1]);
    expect(lifeline.marks[2].bandMove).toBeNull();
    expect(lifeline.change).toBe(3);
  });

  it('should redraw the move when the window widens', () => {
    const lines = [line(300, 40, 'medium'), line(120, 55, 'medium'), line(10, 75, 'high')];

    expect(buildScoreLifeline(lines, '90d', NOW)!.change).toBe(20);
    expect(buildScoreLifeline(lines, '12m', NOW)!.change).toBe(35);
  });
});

describe('buildScoreEvents', () => {
  it('should list one event per line, newest first, the first one with no previous', () => {
    const events = buildScoreEvents([line(60, 61, 'medium'), line(30, 72, 'high'), line(10, 70, 'high')], NOW);

    expect(events.map((event) => [event.kind, event.score, event.previous?.score ?? null])).toEqual([
      ['fall', 70, 72],
      ['rise', 72, 61],
      ['first', 61, null],
    ]);
  });

  it('should give the points and the band change of a move', () => {
    const [fall, rise, first] = buildScoreEvents([line(60, 61, 'medium'), line(30, 72, 'high'), line(10, 70, 'high')], NOW);

    expect(scoreEventPoints(rise)).toBe(11);
    expect(scoreEventBandMove(rise)).toEqual({ from: 'medium', to: 'high' });
    expect(scoreEventPoints(fall)).toBe(-2);
    expect(scoreEventBandMove(fall)).toBeNull();
    expect(scoreEventPoints(first)).toBeNull();
  });

  it('should hold a line only its band wrote, with no points', () => {
    const [held] = buildScoreEvents([line(60, 69, 'medium'), line(30, 69, 'high')], NOW);

    expect(held.kind).toBe('held');
    expect(scoreEventPoints(held)).toBeNull();
    expect(scoreEventBandMove(held)).toEqual({ from: 'medium', to: 'high' });
  });

  it('should list no event for a line that lost its vector, and read the score coming back as a first', () => {
    const events = buildScoreEvents([line(60, 65, 'medium'), { at: daysAgo(30), score: null, band: null }, line(10, 31, 'low')], NOW);

    expect(events.map((event) => [event.kind, event.score, event.previous])).toEqual([
      ['first', 31, null],
      ['first', 65, null],
    ]);
  });

  it('should keep a line older than twelve months out, as the previous of the first event', () => {
    const events = buildScoreEvents([line(400, 50, 'medium'), line(30, 72, 'high')], NOW);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('rise');
    expect(events[0].previous).toEqual({ score: 50, band: 'medium' });
  });
});
