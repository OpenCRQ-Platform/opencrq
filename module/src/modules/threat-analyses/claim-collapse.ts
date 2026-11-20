import { resolveActivityAnchor } from './activity-scoring';

interface DatedClaim {
  id: string,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
}

/**
 * One row per target, however many relationships state it. The actor's header dates its activity
 * from these very anchors (`resolveActivityAnchor`), so the row shown under it is the one that
 * anchor came from: the most recent, an observed date winning an exact tie over an authored one,
 * the claim id settling the rest so a re-render cannot reshuffle the table. Nothing is synthesized:
 * the displayed dates are the ones ONE relationship actually stated.
 *
 * The caller names the target through `identityKey`: the natural key differs per collection (a
 * country, a sector, a CVE id, a technique) and is never the STIX id, which is precisely what
 * differs between two relationships stating the same thing. Input order is preserved.
 */
export const collapseClaimsByTarget = <T extends DatedClaim>(
  rows: Array<T>,
  identityKey: (row: T) => string,
): Array<T> => {
  const anchorScore = (row: T): number => {
    const anchor = resolveActivityAnchor(row);
    return anchor.date === null ? Number.NEGATIVE_INFINITY : anchor.date.getTime();
  };
  const isObserved = (row: T): boolean => resolveActivityAnchor(row).provenance === 'observed';

  const outranks = (candidate: T, current: T): boolean =>
    anchorScore(candidate) > anchorScore(current)
    || (anchorScore(candidate) === anchorScore(current)
      && ((isObserved(candidate) && !isObserved(current))
        || (isObserved(candidate) === isObserved(current) && candidate.id < current.id)));

  const keptByKey = new Map<string, T>();
  for (const row of rows) {
    const key = identityKey(row);
    const current = keptByKey.get(key);
    if (current === undefined || outranks(row, current)) {
      keptByKey.set(key, row);
    }
  }
  return [...keptByKey.values()];
};
