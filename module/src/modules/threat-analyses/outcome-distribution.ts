/** One value of a free-text STIX field, bucketed with every other actor sharing it. `value` is
 * `null` for the actors that stated nothing — that bucket is carried at its true size and never
 * redistributed over the stated ones. */
export interface DistributionBucket {
  value: string | null,
  count: number,
  share: number,
}

/**
 * Buckets a free-text STIX field (`resourceLevel`, `primaryMotivation`) as ingested, one bucket
 * per distinct string plus one for `null`. Stated buckets are ordered by count descending, ties
 * broken alphabetically for a stable read; the unstated bucket is always last, whatever its size,
 * because it is a different kind of thing — an absence, not a value that lost the count race.
 */
export const bucketDistribution = (values: ReadonlyArray<string | null>): Array<DistributionBucket> => {
  const total = values.length;
  const countsByValue = new Map<string, number>();
  let notStatedCount = 0;
  for (const value of values) {
    if (value === null) {
      notStatedCount += 1;
      continue;
    }
    countsByValue.set(value, (countsByValue.get(value) ?? 0) + 1);
  }

  const statedBuckets: Array<DistributionBucket> = [...countsByValue.entries()]
    .sort(([valueA, countA], [valueB, countB]) => (countB - countA) || valueA.localeCompare(valueB))
    .map(([value, count]) => ({ value, count, share: total > 0 ? count / total : 0 }));

  return notStatedCount > 0
    ? [...statedBuckets, { value: null, count: notStatedCount, share: total > 0 ? notStatedCount / total : 0 }]
    : statedBuckets;
};
