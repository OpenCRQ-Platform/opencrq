import { describe, expect, it } from 'vitest';
import { getFindingFirstSeen, getFindingStateSince } from './finding-dates-utils';

describe('getFindingFirstSeen', () => {
  it('returns null for empty history', () => {
    expect(getFindingFirstSeen([])).toBeNull();
  });

  it('returns streak start for a fully applicable history', () => {
    const firstSeen = getFindingFirstSeen([
      { state: 'applicable', enteredAt: '2026-01-01T00:00:00Z' },
      { state: 'applicable', enteredAt: '2026-01-03T00:00:00Z' },
    ]);

    expect(firstSeen).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('returns streak start after the last dismissed entry', () => {
    const firstSeen = getFindingFirstSeen([
      { state: 'applicable', enteredAt: '2026-01-01T00:00:00Z' },
      { state: 'dismissed', enteredAt: '2026-01-02T00:00:00Z' },
      { state: 'applicable', enteredAt: '2026-01-03T00:00:00Z' },
      { state: 'applicable', enteredAt: '2026-01-04T00:00:00Z' },
    ]);

    expect(firstSeen).toEqual(new Date('2026-01-03T00:00:00Z'));
  });

  it('returns null when the latest state is dismissed', () => {
    const firstSeen = getFindingFirstSeen([
      { state: 'applicable', enteredAt: '2026-01-01T00:00:00Z' },
      { state: 'dismissed', enteredAt: '2026-01-02T00:00:00Z' },
    ]);

    expect(firstSeen).toBeNull();
  });
});

describe('getFindingStateSince', () => {
  it('returns null on an empty history', () => {
    expect(getFindingStateSince([])).toBeNull();
  });

  it('dates a state from its latest entry, not from a same-state resync', () => {
    const since = getFindingStateSince([
      { state: 'applicable', enteredAt: '2026-01-01T00:00:00Z' },
      { state: 'dismissed', enteredAt: '2026-01-02T00:00:00Z' },
      { state: 'applicable', enteredAt: '2026-01-03T00:00:00Z' },
      { state: 'applicable', enteredAt: '2026-01-04T00:00:00Z' },
    ]);

    expect(since).toEqual(new Date('2026-01-03T00:00:00Z'));
  });

  it('dates a dismissal from its entry', () => {
    const since = getFindingStateSince([
      { state: 'applicable', enteredAt: '2026-01-01T00:00:00Z' },
      { state: 'dismissed', enteredAt: '2026-01-02T00:00:00Z' },
    ]);

    expect(since).toEqual(new Date('2026-01-02T00:00:00Z'));
  });
});
