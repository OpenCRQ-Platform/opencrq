import { plural } from '@lingui/core/macro';
import type { EvidenceHistoryOrigin } from '@app/module/client';
import type { FlawKind } from '../../finding-detail/dismissal-vocabulary';
import { causeFacts, dismissalCause } from '../../finding-detail/finding-cause-utils';
import { daysSince } from '../../../utils';

/**
 * How long a finding has been open, in whole days.
 *
 * Reported and never scored. The duration measures exposure suffered, where the score measures the
 * evidence standing today, and folding one into the other would make a finding nobody has fixed
 * look more dangerous than the same finding found this morning.
 */
const redDurationLabel = (days: number | null): string | null => {
  if (days === null) {
    return null;
  }
  return plural(days, { one: 'Red for # day', other: 'Red for # days' });
};

/**
 * How long the finding has stood where it stands, in the vocabulary of that state.
 *
 * A dismissed finding is not red, and naming its state again would repeat the chip it sits under,
 * so the reading it adds is the age of the dismissal, worded after its cause. A sync's dismissal
 * is dated by its own row's entry, the test behind it: one confirming a state a person handed back
 * starts no new state, so `currentStateSince` still dates the person's.
 */
export const stateDurationLabel = (
  state: 'applicable' | 'dismissed',
  currentStateSince: string | Date | null,
  { kind, latest }: { kind: FlawKind, latest: { origin: EvidenceHistoryOrigin, enteredAt: string | Date } | null },
  now: Date = new Date(),
): string | null => {
  if (state === 'applicable') {
    const days = daysSince(currentStateSince, now);
    return days === null ? null : redDurationLabel(days);
  }
  if (latest === null || !causeFacts(latest.origin).bySync) {
    const days = daysSince(currentStateSince, now);
    return days === null ? null : plural(days, { one: 'Set aside # day ago', other: 'Set aside # days ago' });
  }
  const days = daysSince(latest.enteredAt, now);
  if (days === null) {
    return null;
  }
  return dismissalCause(kind, latest.origin) === 'not_exposed'
    ? plural(days, { one: 'Not exposed for # day', other: 'Not exposed for # days' })
    : plural(days, { one: 'Not reported for # day', other: 'Not reported for # days' });
};
