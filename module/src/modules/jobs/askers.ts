import type { TriggeredBy } from './schema';

/**
 * Whether `asker` is not the one a row records. A missing field reads as the enqueue default, so two
 * asks booked with no trigger are the same asker.
 */
export const isOtherAsker = (
  row: { triggeredBy: TriggeredBy, triggeredById: string | null },
  asker: { triggeredBy?: TriggeredBy, triggeredById?: string | null },
): boolean =>
  row.triggeredBy !== (asker.triggeredBy ?? 'system') || row.triggeredById !== (asker.triggeredById ?? null);
