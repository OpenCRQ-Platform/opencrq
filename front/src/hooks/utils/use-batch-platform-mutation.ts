import { useToast } from '@filigran/ui';
import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';

/**
 * Runs a drawer's independent sub-mutations and toasts once; the SSE doorbell covers cache
 * freshness. A refusal on one mutation still leaves the others applied — the mutation cache has
 * already toasted it — so the caller is told to keep the drawer open on the refreshed rows
 * instead of closing it.
 */
export const useBatchPlatformMutation = (successMessage: MessageDescriptor) => {
  const { toast } = useToast();

  return async (promises: Array<Promise<unknown>>): Promise<boolean> => {
    if (promises.length === 0) {
      return true;
    }
    const outcomes = await Promise.allSettled(promises);
    if (outcomes.some((outcome) => outcome.status === 'rejected')) {
      return false;
    }
    toast({ description: i18n._(successMessage) });
    return true;
  };
};
