import type { CrqReachGapKind } from '../../crq-indicators/schema';
import type { CategoryResolverInput, ChangeCategory, ChangeEvent, WindowRun } from '../types';

type ReachGap = Awaited<ReturnType<CategoryResolverInput['repo']['findReachGapsByRunIds']>>[number];

const SENTENCE: Record<CrqReachGapKind, { opened: string, closed: string }> = {
  estate: { opened: 'uncontested-by-estate', closed: 'contested-by-estate' },
  catalogue: { opened: 'uncontestable-by-catalogue', closed: 'contestable-by-catalogue' },
};

/** A run older than the reach gap table stores neither count, and reads as no gap rather than as an empty set. */
const storesReachGaps = (run: Pick<WindowRun, 'uncontestedPairCount' | 'uncontestablePairCount'>): boolean =>
  run.uncontestedPairCount !== null && run.uncontestablePairCount !== null;

const pairKey = (gap: ReachGap): string => `${gap.externalId}/${gap.family}`;

const pairEvent = (runId: string, gap: ReachGap, opened: boolean): ChangeEvent => ({
  category: 'technique-coverage',
  moment: { kind: 'run', runId },
  direction: opened ? 'up' : 'down',
  item: { kind: 'technique-family', key: pairKey(gap), label: gap.name, link: { kind: 'technique', externalId: gap.externalId } },
  sentence: { key: SENTENCE[gap.gap][opened ? 'opened' : 'closed'], parts: { technique: gap.externalId, family: gap.family } },
  values: null,
});

/**
 * The two ends alone decide what is listed: a pair entering then leaving the gaps inside the window
 * lists nothing, nor does a pair moving from one gap to the other, which nothing contests in either
 * run. A listed pair hangs on the earliest run from which it held the state the later run has, out
 * of the gaps or in the gap kind its sentence names. Without stored gaps an end lists nothing, and a
 * run inside the window is skipped.
 */
export const techniqueCoverageCategory: ChangeCategory = {
  key: 'technique-coverage',
  tabs: ['ale', 'susceptibility'],
  resolve: async ({ before, after, window, repo }) => {
    if (!storesReachGaps(before.run) || !storesReachGaps(after.run)) {
      return [];
    }
    const inner = window.filter((run) => run.id !== before.run.id && run.id !== after.run.id && storesReachGaps(run));
    const runIds = [before.run.id, ...inner.map((run) => run.id), after.run.id];
    const gaps = await repo.findReachGapsByRunIds(runIds);
    const gapsOf = new Map(runIds.map((runId) => [runId, new Map<string, CrqReachGapKind>()]));
    for (const gap of gaps) {
      gapsOf.get(gap.runId)?.set(pairKey(gap), gap.gap);
    }

    const anchorOf = (key: string): string => {
      const final = gapsOf.get(after.run.id)?.get(key);
      let anchor = after.run.id;
      for (let index = runIds.length - 2; index > 0 && gapsOf.get(runIds[index])?.get(key) === final; index--) {
        anchor = runIds[index];
      }
      return anchor;
    };

    const beforeGaps = gaps.filter((gap) => gap.runId === before.run.id);
    const afterGaps = gaps.filter((gap) => gap.runId === after.run.id);
    const beforeKeys = gapsOf.get(before.run.id) ?? new Map<string, CrqReachGapKind>();
    const afterKeys = gapsOf.get(after.run.id) ?? new Map<string, CrqReachGapKind>();
    return [
      ...afterGaps.filter((gap) => !beforeKeys.has(pairKey(gap))).map((gap) => pairEvent(anchorOf(pairKey(gap)), gap, true)),
      ...beforeGaps.filter((gap) => !afterKeys.has(pairKey(gap))).map((gap) => pairEvent(anchorOf(pairKey(gap)), gap, false)),
    ];
  },
};
