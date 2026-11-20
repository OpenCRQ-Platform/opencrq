import type { CategoryResolverInput, ChangeCategory, ChangeDirection, ChangeEvent, ChangeLink } from '../types';
import { computePertExpectedValue } from '../../scenario-loss-estimates/pert';

type Repo = CategoryResolverInput['repo'];
type TefEstimate = Awaited<ReturnType<Repo['findTefEstimatesByScenarioId']>>[number];

interface Triplet {
  min: number,
  likely: number,
  max: number,
}

type TefMode = 'automatic' | 'manual';

interface RunTef {
  mode: TefMode,
  triplet: Triplet,
}

const TEF_LINK: ChangeLink = { kind: 'scenario-tab', tab: 'threat' };

const tripletOf = (run: { tefMin: number | null, tefLikely: number | null, tefMax: number | null }): Triplet | null =>
  (run.tefMin === null || run.tefLikely === null || run.tefMax === null
    ? null
    : { min: run.tefMin, likely: run.tefLikely, max: run.tefMax });

const sameTriplet = (a: Triplet, b: Triplet): boolean => a.min === b.min && a.likely === b.likely && a.max === b.max;

/** A scenario's first estimate is written while its first run reads, so a run older than every estimate is matched against it. */
const estimateInForce = (estimates: ReadonlyArray<TefEstimate>, at: Date): TefEstimate | undefined =>
  estimates.findLast((estimate) => estimate.createdAt.getTime() <= at.getTime()) ?? estimates.at(0);

const runTef = (triplet: Triplet, readAt: Date, estimates: ReadonlyArray<TefEstimate>): RunTef => {
  const estimate = estimateInForce(estimates, readAt);
  const automatic = estimate !== undefined && sameTriplet(triplet, estimate);
  return { mode: automatic ? 'automatic' : 'manual', triplet };
};

const directionBetween = (before: number, after: number): ChangeDirection => {
  if (after === before) {
    return 'none';
  }
  return after > before ? 'up' : 'down';
};

const tripletDirection = (before: Triplet, after: Triplet): ChangeDirection =>
  directionBetween(
    computePertExpectedValue(before.min, before.likely, before.max),
    computePertExpectedValue(after.min, after.likely, after.max),
  );

const tripletParts = (before: Triplet, after: Triplet): Record<string, number> => ({
  beforeMin: before.min,
  beforeLikely: before.likely,
  beforeMax: before.max,
  afterMin: after.min,
  afterLikely: after.likely,
  afterMax: after.max,
});

const inputEvent = (runId: string, key: 'mode' | 'manual-triplet', sentenceKey: string, before: Triplet, after: Triplet): ChangeEvent => ({
  category: 'attack-frequency',
  moment: { kind: 'run', runId },
  direction: tripletDirection(before, after),
  item: { kind: 'tef-input', key, label: null, link: TEF_LINK },
  sentence: { key: sentenceKey, parts: tripletParts(before, after) },
  values: null,
});

/** A read with no size declared names no class, whichever classes it mixed. */
const sizeOf = (estimate: TefEstimate): string => (estimate.sizeSource === 'none' ? '' : (estimate.readSizeClasses ?? []).join(', '));

const readOf = (estimate: TefEstimate) => (estimate.catalogId === null || estimate.sizeSource === null
  ? null
  : { country: estimate.countryName ?? estimate.countryIsoAlpha3 ?? '', sector: estimate.sectorName ?? '', size: sizeOf(estimate), sizeSource: estimate.sizeSource });

type ReadDimension = 'country' | 'sector' | 'size';

const READ_DIMENSIONS: ReadonlyArray<ReadDimension> = ['country', 'sector', 'size'];

/** The catalogue an estimate was read from: a multiplier vintage or a package version. */
const catalogueOf = (estimate: TefEstimate): string => (estimate.catalogId === null ? `vintage ${estimate.catalogVintage ?? ''}` : `${estimate.catalogId} ${estimate.catalogVersion ?? ''}`);

/**
 * A package by its id and version under `before` or `after`, a multiplier vintage by its number alone
 * under `beforeVintage` or `afterVintage`, since the reader's language words it.
 */
const catalogueParts = (side: 'before' | 'after', estimate: TefEstimate): Record<string, string | number> =>
  (estimate.catalogId === null
    ? { [`${side}Vintage`]: estimate.catalogVintage ?? '' }
    : { [side]: `${estimate.catalogId} ${estimate.catalogVersion ?? ''}` });

const readEvent = (previous: TefEstimate, estimate: TefEstimate, key: ReadDimension | 'catalogue', sentence: ChangeEvent['sentence']): ChangeEvent => ({
  category: 'attack-frequency',
  moment: { kind: 'recorded', at: estimate.createdAt.toISOString() },
  direction: tripletDirection(previous, estimate),
  item: { kind: 'tef-read', key, label: null, link: TEF_LINK },
  sentence,
  values: null,
});

/**
 * One event for a moved catalogue and one per moved field of the profile read, so a single edit of
 * the risk scope reads as one sentence. The fields are the profile's, which no catalogue moves, so a
 * recompute that read a new catalogue on a moved profile names both.
 */
const readEvents = (previous: TefEstimate, estimate: TefEstimate): Array<ChangeEvent> => {
  const readsAPackage = previous.catalogId !== null || estimate.catalogId !== null;
  const sameCatalogue = previous.catalogId !== null && previous.catalogId === estimate.catalogId;
  const catalogue = catalogueOf(previous) !== catalogueOf(estimate) && readsAPackage
    ? [readEvent(previous, estimate, 'catalogue', sameCatalogue
      ? { key: 'tef-catalogue-version-changed', parts: { before: previous.catalogVersion ?? '', after: estimate.catalogVersion ?? '' } }
      : { key: 'tef-catalogue-changed', parts: { ...catalogueParts('before', previous), ...catalogueParts('after', estimate) } })]
    : [];
  const before = readOf(previous);
  const after = readOf(estimate);
  if (before === null || after === null) {
    return catalogue;
  }
  return [...catalogue, ...READ_DIMENSIONS.flatMap((dimension) => {
    if (before[dimension] === after[dimension] && (dimension !== 'size' || before.sizeSource === after.sizeSource)) {
      return [];
    }
    const parts: Record<string, string> = { before: before[dimension], after: after[dimension] };
    if (dimension === 'size') {
      parts.beforeSource = before.sizeSource;
      parts.afterSource = after.sizeSource;
    }
    return [readEvent(previous, estimate, dimension, { key: `tef-${dimension}-changed`, parts })];
  })];
};

const estimateEvents = (estimates: ReadonlyArray<TefEstimate>, from: Date, to: Date): Array<ChangeEvent> =>
  estimates.flatMap((estimate, index) =>
    (index > 0 && estimate.createdAt.getTime() > from.getTime() && estimate.createdAt.getTime() <= to.getTime()
      ? readEvents(estimates[index - 1], estimate)
      : []));

/**
 * Manual inputs keep no history, so a run reads as automatic when it drew the estimate in force at
 * its reading time, and as manual otherwise. A mode switch and a new manual triplet hang on the
 * earliest run of the window from which the later run's state held. What moved the estimate (its
 * catalogue or the profile it reads) is listed while either end is automatic, since a manual
 * frequency reads none of it.
 */
export const attackFrequencyCategory: ChangeCategory = {
  key: 'attack-frequency',
  tabs: ['ale', 'tef'],
  resolve: async ({ riskScenarioId, before, after, window, repo }) => {
    const beforeTriplet = tripletOf(before.run);
    const afterTriplet = tripletOf(after.run);
    if (beforeTriplet === null || afterTriplet === null) {
      return [];
    }
    const innerIds = window.filter((run) => run.id !== before.run.id && run.id !== after.run.id).map((run) => run.id);
    const [estimates, innerTriplets] = await Promise.all([
      repo.findTefEstimatesByScenarioId(riskScenarioId),
      innerIds.length === 0 ? [] : repo.findRunTefTripletsByIds(innerIds),
    ]);
    const tripletById = new Map(innerTriplets.map((run) => [run.id, tripletOf(run)]));

    const ends = { before: runTef(beforeTriplet, before.readAt, estimates), after: runTef(afterTriplet, after.readAt, estimates) };
    const inner = window.flatMap((run) => {
      const triplet = tripletById.get(run.id);
      return triplet === undefined || triplet === null
        ? []
        : [{ id: run.id, tef: runTef(triplet, run.readAt ?? run.createdAt, estimates) }];
    });
    const anchorOf = (held: (tef: RunTef) => boolean): string => {
      let anchor = after.run.id;
      for (let index = inner.length - 1; index >= 0 && held(inner[index].tef); index--) {
        anchor = inner[index].id;
      }
      return anchor;
    };

    const events: Array<ChangeEvent> = [];
    if (ends.before.mode !== ends.after.mode) {
      events.push(inputEvent(
        anchorOf((tef) => tef.mode === ends.after.mode),
        'mode',
        ends.after.mode === 'manual' ? 'tef-mode-manual' : 'tef-mode-automatic',
        beforeTriplet,
        afterTriplet,
      ));
    } else if (ends.after.mode === 'manual' && !sameTriplet(beforeTriplet, afterTriplet)) {
      events.push(inputEvent(
        anchorOf((tef) => tef.mode === 'manual' && sameTriplet(tef.triplet, afterTriplet)),
        'manual-triplet',
        'tef-manual-changed',
        beforeTriplet,
        afterTriplet,
      ));
    }
    if (ends.before.mode === 'automatic' || ends.after.mode === 'automatic') {
      events.push(...estimateEvents(estimates, before.readAt, after.readAt));
    }
    return events;
  },
};
