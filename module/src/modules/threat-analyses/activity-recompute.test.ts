import { describe, expect, it } from 'vitest';
import type { ActivityLineage } from './activity-lineage';
import type { ActivityAnchorRow, ActivityWatermark } from './activity-recompute';
import {
  buildActivityAnchorRows,
  chooseActivityScope,
  foldActivityAnchors,
  gateMovedFor,
  isStaleActivity,
  selectActivityFoldIds,
} from './activity-recompute';

const NOW = new Date('2026-09-08T00:00:00Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

const watermark = (values: Partial<ActivityWatermark>): ActivityWatermark => ({
  id: 'a',
  updatedAt: daysAgo(10),
  activityComputedAt: daysAgo(5),
  activityGate: 60,
  lastObservedViaAnalysisId: null,
  ...values,
});

const anchor = (values: Partial<ActivityAnchorRow>): ActivityAnchorRow => ({
  analysisId: 'a',
  kind: 'technique',
  observedAt: null,
  authoredAt: null,
  confidence: null,
  ...values,
});

describe('isStaleActivity', () => {
  it('marks an actor never folded', () => {
    expect(isStaleActivity(watermark({ activityComputedAt: null }))).toBe(true);
  });

  it('marks an actor an ingestion touched since its last fold', () => {
    expect(isStaleActivity(watermark({ updatedAt: daysAgo(1), activityComputedAt: daysAgo(2) }))).toBe(true);
  });

  it('leaves an actor untouched since its last fold', () => {
    expect(isStaleActivity(watermark({ updatedAt: daysAgo(2), activityComputedAt: daysAgo(1) }))).toBe(false);
  });
});

describe('gateMovedFor', () => {
  it('sees a gate no fold has applied yet', () => {
    expect(gateMovedFor([watermark({ activityGate: null })], 60)).toBe(true);
  });

  it('sees a gate that changed since the last full pass', () => {
    expect(gateMovedFor([watermark({ activityGate: 60 }), watermark({ activityGate: 60 })], 40)).toBe(true);
  });

  it('sees nothing when every actor was folded under the current gate', () => {
    expect(gateMovedFor([watermark({ activityGate: 40 }), watermark({ activityGate: 40 })], 40)).toBe(false);
  });
});

describe('chooseActivityScope', () => {
  it('folds the whole tenant when the gate moved, day or not', () => {
    expect(chooseActivityScope({ gateMoved: true, isDailyBooking: false })).toBe('tenant');
    expect(chooseActivityScope({ gateMoved: true, isDailyBooking: true })).toBe('tenant');
  });

  it('folds the whole tenant on the daily booking', () => {
    expect(chooseActivityScope({ gateMoved: false, isDailyBooking: true })).toBe('clock');
  });

  it('leaves every untouched actor alone on a change-driven run', () => {
    expect(chooseActivityScope({ gateMoved: false, isDailyBooking: false })).toBe('changed');
  });
});

describe('buildActivityAnchorRows', () => {
  const claim = {
    analysisId: 'a',
    stixRelationId: 'relationship--1',
    relCreated: daysAgo(300),
    relStartTime: daysAgo(20),
    relStopTime: daysAgo(10),
    relConfidence: 80,
    producerStixId: 'identity--1',
  };

  it('keeps both dates on a claim that carries a window', () => {
    const [row] = buildActivityAnchorRows('t', { location: [claim], sector: [], cve: [], technique: [] }, []);
    expect(row).toMatchObject({
      tenantId: 't',
      analysisId: 'a',
      kind: 'location',
      stixRelationId: 'relationship--1',
      observedAt: daysAgo(10),
      authoredAt: daysAgo(300),
      confidence: 80,
    });
  });

  it('prefers the stop time and falls back to the start time', () => {
    const [row] = buildActivityAnchorRows(
      't',
      { location: [], sector: [], cve: [], technique: [{ ...claim, relStopTime: null }] },
      [],
    );
    expect(row?.observedAt).toEqual(daysAgo(20));
  });

  it('writes one row per actor for its own last seen', () => {
    const rows = buildActivityAnchorRows('t', { location: [], sector: [], cve: [], technique: [] }, [
      { analysisId: 'a', stixId: 'intrusion-set--1', firstSeen: null, lastSeen: daysAgo(30) },
      { analysisId: 'b', stixId: 'intrusion-set--2', firstSeen: null, lastSeen: null },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'actor', stixRelationId: 'intrusion-set--1', observedAt: daysAgo(30), authoredAt: null });
    expect(rows[1]).toMatchObject({ kind: 'actor', analysisId: 'b', observedAt: null });
  });

  it('dates an actor by its first seen when it states no last seen', () => {
    const [row] = buildActivityAnchorRows('t', { location: [], sector: [], cve: [], technique: [] }, [
      { analysisId: 'a', stixId: 'campaign--1', firstSeen: daysAgo(40), lastSeen: null },
    ]);
    expect(row).toMatchObject({ kind: 'actor', observedAt: daysAgo(40), authoredAt: null });
  });

  it('prefers the last seen over the first seen, whatever their order', () => {
    const [row] = buildActivityAnchorRows('t', { location: [], sector: [], cve: [], technique: [] }, [
      { analysisId: 'a', stixId: 'campaign--1', firstSeen: daysAgo(10), lastSeen: daysAgo(40) },
    ]);
    expect(row?.observedAt).toEqual(daysAgo(40));
  });

  it('leaves an actor stating neither date undated', () => {
    const [row] = buildActivityAnchorRows('t', { location: [], sector: [], cve: [], technique: [] }, [
      { analysisId: 'a', stixId: 'campaign--1', firstSeen: null, lastSeen: null },
    ]);
    expect(row?.observedAt).toBeNull();
  });
});

describe('foldActivityAnchors', () => {
  it('gives an actor with no anchor an empty fold', () => {
    expect(foldActivityAnchors(['a'], [], 60, NOW, new Map()).get('a')).toEqual({
      lastObservedAt: null,
      lastObservedViaId: null,
      lastAuthoredAt: null,
      activityScore: null,
    });
  });

  it('leaves an actor carrying authoring dates alone unscored, its authored date still written', () => {
    const fold = foldActivityAnchors(['a'], [
      anchor({ authoredAt: daysAgo(1) }),
      anchor({ authoredAt: daysAgo(40) }),
    ], 60, NOW, new Map());
    expect(fold.get('a')).toEqual({
      lastObservedAt: null,
      lastObservedViaId: null,
      lastAuthoredAt: daysAgo(1),
      activityScore: null,
    });
  });

  it('never lets a recent authoring date lift a stale observation', () => {
    const observedOnly = foldActivityAnchors(['a'], [anchor({ observedAt: daysAgo(500) })], 60, NOW, new Map());
    const withRecentAuthoring = foldActivityAnchors(['a'], [
      anchor({ observedAt: daysAgo(500) }),
      anchor({ authoredAt: daysAgo(1) }),
    ], 60, NOW, new Map());
    expect(observedOnly.get('a')?.lastObservedAt).toEqual(daysAgo(500));
    expect(withRecentAuthoring.get('a')).toMatchObject({
      lastObservedAt: daysAgo(500),
      activityScore: observedOnly.get('a')?.activityScore,
    });
  });

  it('dates a claim by the column that carries its date', () => {
    const fold = foldActivityAnchors(['a'], [
      anchor({ observedAt: daysAgo(10), authoredAt: daysAgo(300) }),
      anchor({ authoredAt: daysAgo(40) }),
    ], 60, NOW, new Map());
    expect(fold.get('a')).toMatchObject({
      lastObservedAt: daysAgo(10),
      lastAuthoredAt: daysAgo(40),
    });
  });

  it('drops a claim below the gate', () => {
    const rows = [anchor({ observedAt: daysAgo(10), confidence: 50 })];
    expect(foldActivityAnchors(['a'], rows, 60, NOW, new Map()).get('a')?.lastObservedAt).toBeNull();
    expect(foldActivityAnchors(['a'], rows, 40, NOW, new Map()).get('a')?.lastObservedAt).toEqual(daysAgo(10));
  });

  it('reads an unstated confidence at the default the gate compares', () => {
    const rows = [anchor({ observedAt: daysAgo(10), confidence: null })];
    expect(foldActivityAnchors(['a'], rows, 60, NOW, new Map()).get('a')?.lastObservedAt).toEqual(daysAgo(10));
    expect(foldActivityAnchors(['a'], rows, 80, NOW, new Map()).get('a')?.lastObservedAt).toBeNull();
  });

  it('never gates the actor own last seen', () => {
    const fold = foldActivityAnchors(['a'], [anchor({ kind: 'actor', observedAt: daysAgo(30) })], 100, NOW, new Map());
    expect(fold.get('a')).toMatchObject({ lastObservedAt: daysAgo(30) });
  });

  it('reads an actor row dated by its first seen as an observation', () => {
    const [row] = buildActivityAnchorRows('t', { location: [], sector: [], cve: [], technique: [] }, [
      { analysisId: 'a', stixId: 'campaign--1', firstSeen: daysAgo(30), lastSeen: null },
    ]);
    const fold = foldActivityAnchors(['a'], [anchor({ kind: 'actor', observedAt: row?.observedAt ?? null })], 60, NOW, new Map());
    expect(fold.get('a')).toMatchObject({ lastObservedAt: daysAgo(30) });
  });

  it('ignores an anchor of an actor outside the batch', () => {
    expect(foldActivityAnchors(['a'], [anchor({ analysisId: 'b', observedAt: daysAgo(1) })], 60, NOW, new Map()).has('b')).toBe(false);
  });

  describe('with a date later than now', () => {
    const endOfYear = new Date('2026-12-31T00:00:00Z');

    it('dates an actor whose own last seen is in the future as of now', () => {
      const fold = foldActivityAnchors(['a'], [anchor({ kind: 'actor', observedAt: endOfYear })], 60, NOW, new Map());
      expect(fold.get('a')?.lastObservedAt).toEqual(NOW);
    });

    it('dates and scores a claim whose window ends in the future as observed now', () => {
      const future = foldActivityAnchors(['a'], [anchor({ observedAt: endOfYear })], 60, NOW, new Map());
      const today = foldActivityAnchors(['a'], [anchor({ observedAt: NOW })], 60, NOW, new Map());
      expect(future.get('a')).toEqual(today.get('a'));
    });

    it('counts future dates on several days as the single day of now', () => {
      const future = foldActivityAnchors(['a'], [
        anchor({ observedAt: endOfYear }),
        anchor({ observedAt: new Date('2027-03-01T00:00:00Z') }),
      ], 60, NOW, new Map());
      const today = foldActivityAnchors(['a'], [anchor({ observedAt: NOW })], 60, NOW, new Map());
      expect(future.get('a')?.activityScore).toBe(today.get('a')?.activityScore);
    });

    it('gives the threat the source date back once the clock has passed it', () => {
      const later = new Date('2027-01-15T00:00:00Z');
      const fold = foldActivityAnchors(['a'], [anchor({ kind: 'actor', observedAt: endOfYear })], 60, later, new Map());
      expect(fold.get('a')?.lastObservedAt).toEqual(endOfYear);
    });
  });

  describe('with descendants', () => {
    const lineage = (entries: Record<string, Array<string>>): Map<string, Set<string>> =>
      new Map(Object.entries(entries).map(([id, children]) => [id, new Set(children)]));

    it('dates an undated actor by the actor row of a descendant, which it does not fold', () => {
      const folds = foldActivityAnchors(
        ['set'],
        [anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(10) })],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(folds.get('set')).toMatchObject({ lastObservedAt: daysAgo(10) });
      expect(folds.has('campaign')).toBe(false);
    });

    it('scores an actor dated only by a descendant, and leaves an actor with neither unknown', () => {
      const folds = foldActivityAnchors(
        ['set', 'lonely'],
        [anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(10) })],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(folds.get('set')?.lastObservedAt).toEqual(daysAgo(10));
      expect(folds.get('set')?.activityScore).toBeGreaterThan(0);
      expect(folds.get('lonely')).toEqual({
        lastObservedAt: null,
        lastObservedViaId: null,
        lastAuthoredAt: null,
        activityScore: null,
      });
    });

    it('does not let an observed claim of a descendant below the gate date its ancestor', () => {
      const rows = [anchor({ analysisId: 'campaign', observedAt: daysAgo(10), confidence: 50 })];
      expect(foldActivityAnchors(['set'], rows, 60, NOW, lineage({ set: ['campaign'] })).get('set')).toMatchObject({
        lastObservedAt: null,
      });
      expect(foldActivityAnchors(['set'], rows, 40, NOW, lineage({ set: ['campaign'] })).get('set')?.lastObservedAt)
        .toEqual(daysAgo(10));
    });

    it('does not lift the authoring date of a descendant', () => {
      const folds = foldActivityAnchors(
        ['set'],
        [
          anchor({ analysisId: 'set', authoredAt: daysAgo(40) }),
          anchor({ analysisId: 'campaign', authoredAt: daysAgo(1) }),
        ],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(folds.get('set')).toMatchObject({ lastObservedAt: null, lastAuthoredAt: daysAgo(40) });
    });

    it('dates its parent as of now when a descendant is dated in the future', () => {
      const folds = foldActivityAnchors(
        ['set'],
        [anchor({ analysisId: 'campaign', kind: 'actor', observedAt: new Date('2026-12-31T00:00:00Z') })],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(folds.get('set')).toMatchObject({ lastObservedAt: NOW, lastObservedViaId: 'campaign' });
    });

    it('does not let a descendant dated in the future take the date from a parent observed now', () => {
      const folds = foldActivityAnchors(
        ['set'],
        [
          anchor({ analysisId: 'set', kind: 'actor', observedAt: NOW }),
          anchor({ analysisId: 'campaign', kind: 'actor', observedAt: new Date('2026-12-31T00:00:00Z') }),
        ],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(folds.get('set')).toMatchObject({ lastObservedAt: NOW, lastObservedViaId: null });
    });

    it('keeps the date of the parent when it is more recent than its descendants', () => {
      const folds = foldActivityAnchors(
        ['set'],
        [
          anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(5) }),
          anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(50) }),
        ],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(folds.get('set')?.lastObservedAt).toEqual(daysAgo(5));
    });

    it('counts a day shared by the parent and its descendant once', () => {
      const alone = foldActivityAnchors(
        ['set'],
        [anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(20) })],
        60,
        NOW,
        new Map(),
      );
      const shared = foldActivityAnchors(
        ['set'],
        [
          anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(20) }),
          anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(20) }),
        ],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(shared.get('set')?.activityScore).toBe(alone.get('set')?.activityScore);
    });

    it('adds the days a descendant brings to the score', () => {
      const alone = foldActivityAnchors(
        ['set'],
        [anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(20) })],
        60,
        NOW,
        new Map(),
      );
      const withDescendant = foldActivityAnchors(
        ['set'],
        [
          anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(20) }),
          anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(30) }),
        ],
        60,
        NOW,
        lineage({ set: ['campaign'] }),
      );
      expect(withDescendant.get('set')?.activityScore).toBeGreaterThan(alone.get('set')?.activityScore ?? 0);
    });

    it('reads a descendant with no row as contributing nothing', () => {
      const rows = [anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(20) })];
      expect(foldActivityAnchors(['set'], rows, 60, NOW, lineage({ set: ['ghost'] })))
        .toEqual(foldActivityAnchors(['set'], rows, 60, NOW, new Map()));
    });

    it('reaches every descendant the map lists, whatever the order of the rows', () => {
      const rows = [
        anchor({ analysisId: 'b', kind: 'actor', observedAt: daysAgo(3) }),
        anchor({ analysisId: 'a', kind: 'actor', observedAt: daysAgo(4) }),
      ];
      const forward = foldActivityAnchors(['set'], rows, 60, NOW, lineage({ set: ['a', 'b'] }));
      const reversed = foldActivityAnchors(['set'], [...rows].reverse(), 60, NOW, lineage({ set: ['b', 'a'] }));
      expect(forward.get('set')?.lastObservedAt).toEqual(daysAgo(3));
      expect(reversed).toEqual(forward);
    });

    it('folds the actor and the threat above it each from their own descendants', () => {
      const folds = foldActivityAnchors(
        ['actor', 'set'],
        [anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(10) })],
        60,
        NOW,
        lineage({ set: ['campaign'], actor: ['set', 'campaign'] }),
      );
      expect(folds.get('actor')?.lastObservedAt).toEqual(daysAgo(10));
      expect(folds.get('set')?.lastObservedAt).toEqual(daysAgo(10));
    });

    describe('source of the date', () => {
      it('names the campaign that dates its undated parent', () => {
        const folds = foldActivityAnchors(
          ['set'],
          [anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(10) })],
          60,
          NOW,
          lineage({ set: ['campaign'] }),
        );
        expect(folds.get('set')?.lastObservedViaId).toBe('campaign');
      });

      it('names nothing when the parent has a more recent date of its own', () => {
        const folds = foldActivityAnchors(
          ['set'],
          [
            anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(5) }),
            anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(50) }),
          ],
          60,
          NOW,
          lineage({ set: ['campaign'] }),
        );
        expect(folds.get('set')?.lastObservedViaId).toBeNull();
      });

      it('names nothing when a descendant only ties the date of the parent', () => {
        const folds = foldActivityAnchors(
          ['set'],
          [
            anchor({ analysisId: 'set', kind: 'actor', observedAt: daysAgo(10) }),
            anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(10) }),
          ],
          60,
          NOW,
          lineage({ set: ['campaign'] }),
        );
        expect(folds.get('set')?.lastObservedViaId).toBeNull();
      });

      it('names the campaign, not the undated intrusion set between it and the threat actor', () => {
        const folds = foldActivityAnchors(
          ['actor', 'set'],
          [anchor({ analysisId: 'campaign', kind: 'actor', observedAt: daysAgo(10) })],
          60,
          NOW,
          lineage({ set: ['campaign'], actor: ['set', 'campaign'] }),
        );
        expect(folds.get('actor')?.lastObservedViaId).toBe('campaign');
        expect(folds.get('set')?.lastObservedViaId).toBe('campaign');
      });

      it('names the smallest id among descendants tied on the date, whatever the order', () => {
        const rows = [
          anchor({ analysisId: 'b', kind: 'actor', observedAt: daysAgo(10) }),
          anchor({ analysisId: 'a', kind: 'actor', observedAt: daysAgo(10) }),
        ];
        expect(foldActivityAnchors(['set'], rows, 60, NOW, lineage({ set: ['b', 'a'] })).get('set')?.lastObservedViaId).toBe('a');
        expect(foldActivityAnchors(['set'], [...rows].reverse(), 60, NOW, lineage({ set: ['a', 'b'] })).get('set')?.lastObservedViaId).toBe('a');
      });

      it('names nothing when no date exists at all', () => {
        const folds = foldActivityAnchors(
          ['set'],
          [anchor({ analysisId: 'campaign', kind: 'actor', observedAt: null })],
          60,
          NOW,
          lineage({ set: ['campaign'] }),
        );
        expect(folds.get('set')?.lastObservedViaId).toBeNull();
      });
    });
  });
});

describe('selectActivityFoldIds', () => {
  const sets = (entries: Record<string, Array<string>>): Map<string, Set<string>> =>
    new Map(Object.entries(entries).map(([id, others]) => [id, new Set(others)]));

  const lineageOf = (ancestors: Record<string, Array<string>>): ActivityLineage => {
    const descendants: Record<string, Array<string>> = {};
    for (const [child, parents] of Object.entries(ancestors)) {
      for (const parent of parents) {
        descendants[parent] = [...(descendants[parent] ?? []), child];
      }
    }
    return { ancestors: sets(ancestors), descendants: sets(descendants) };
  };

  const noLineage: ActivityLineage = { ancestors: new Map(), descendants: new Map() };
  const watermarkIds = ['actor', 'campaign', 'other', 'set'];
  const watermarks = watermarkIds.map((id) => watermark({ id }));

  it('folds the ancestors of a stale threat on a change-driven run', () => {
    const { foldIds } = selectActivityFoldIds({
      scope: 'changed',
      watermarks,
      staleIds: ['campaign'],
      lineage: lineageOf({ campaign: ['set', 'actor'], set: ['actor'] }),
    });
    expect(foldIds).toEqual(['actor', 'campaign', 'set']);
  });

  it('drops an ancestor that has no watermark', () => {
    const { foldIds } = selectActivityFoldIds({
      scope: 'changed',
      watermarks,
      staleIds: ['campaign'],
      lineage: lineageOf({ campaign: ['ghost', 'set'] }),
    });
    expect(foldIds).toEqual(['campaign', 'set']);
  });

  it('folds the stale threats alone when nothing is attributed', () => {
    const { foldIds } = selectActivityFoldIds({ scope: 'changed', watermarks, staleIds: ['other', 'set'], lineage: noLineage });
    expect(foldIds).toEqual(['other', 'set']);
  });

  it('counts a threat both stale and ancestor of a stale one once', () => {
    const { foldIds } = selectActivityFoldIds({
      scope: 'changed',
      watermarks,
      staleIds: ['campaign', 'set'],
      lineage: lineageOf({ campaign: ['set'] }),
    });
    expect(foldIds).toEqual(['campaign', 'set']);
  });

  describe('threats dated by a source that is no longer one of their descendants', () => {
    const watermarksOf = (vias: Record<string, string | null>): Array<ActivityWatermark> =>
      watermarkIds.map((id) => watermark({ id, lastObservedViaAnalysisId: vias[id] ?? null }));

    it('folds a threat whose source the lineage no longer links to it, though nothing is stale above it', () => {
      const { foldIds } = selectActivityFoldIds({
        scope: 'changed',
        watermarks: watermarksOf({ set: 'campaign' }),
        staleIds: ['other'],
        lineage: noLineage,
      });
      expect(foldIds).toEqual(['other', 'set']);
    });

    it('folds a threat whose source lost an intermediate link', () => {
      const { foldIds } = selectActivityFoldIds({
        scope: 'changed',
        watermarks: watermarksOf({ actor: 'campaign' }),
        staleIds: ['set'],
        lineage: lineageOf({ campaign: ['set'] }),
      });
      expect(foldIds).toEqual(['actor', 'set']);
    });

    it('folds a threat whose source is not a threat of the tenant any more', () => {
      const { foldIds } = selectActivityFoldIds({
        scope: 'changed',
        watermarks: watermarksOf({ set: 'deleted-campaign' }),
        staleIds: ['other'],
        lineage: noLineage,
      });
      expect(foldIds).toEqual(['other', 'set']);
    });

    it('leaves a threat whose source is still one of its descendants and is not stale', () => {
      const { foldIds } = selectActivityFoldIds({
        scope: 'changed',
        watermarks: watermarksOf({ set: 'campaign' }),
        staleIds: ['other'],
        lineage: lineageOf({ campaign: ['set'] }),
      });
      expect(foldIds).toEqual(['other']);
    });

    it('reads the anchors of a threat folded for its vanished source', () => {
      const { anchorReadIds } = selectActivityFoldIds({
        scope: 'changed',
        watermarks: watermarksOf({ set: 'deleted-campaign' }),
        staleIds: [],
        lineage: lineageOf({ actor: ['set'] }),
      });
      expect([...anchorReadIds].sort()).toEqual(['actor', 'set']);
    });
  });

  it.each(['tenant', 'clock'] as const)('folds every watermark on a %s run', (scope) => {
    const { foldIds } = selectActivityFoldIds({ scope, watermarks, staleIds: ['campaign'], lineage: lineageOf({ campaign: ['set'] }) });
    expect(foldIds).toEqual(watermarkIds);
  });

  it('reads the anchors of the descendants of a folded ancestor even when they are not stale', () => {
    const { foldIds, anchorReadIds } = selectActivityFoldIds({
      scope: 'changed',
      watermarks,
      staleIds: ['campaign'],
      lineage: lineageOf({ campaign: ['set'], other: ['set'] }),
    });
    expect(foldIds).toEqual(['campaign', 'set']);
    expect([...anchorReadIds].sort()).toEqual(['campaign', 'other', 'set']);
  });

  it('reads no anchor twice', () => {
    const { anchorReadIds } = selectActivityFoldIds({
      scope: 'tenant',
      watermarks,
      staleIds: [],
      lineage: lineageOf({ campaign: ['set', 'actor'], set: ['actor'] }),
    });
    expect(anchorReadIds).toHaveLength(new Set(anchorReadIds).size);
    expect([...anchorReadIds].sort()).toEqual(watermarkIds);
  });
});
