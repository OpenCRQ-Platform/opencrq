import { useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { useToast } from '@filigran/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useJobStatus } from '../../hooks';
import { useTRPC } from '../../lib';

interface CrqSimulationOrchestratorResult {
  isRunning: boolean,
  isDisabled: boolean,
  onRun: () => void,
}

/**
 * Orchestrates the CRQ simulation lifecycle for a risk scenario:
 * 1. Auto-enqueues a job on first visit when no run exists.
 * 2. Reports the run in flight from the server, so every Run control of the scenario agrees on it.
 *    The id the enqueue returns covers the round trip before that read sees it.
 * 3. The SSE event stream invalidates the queries when the job changes state.
 *
 * The auto-enqueue guard is a ref per instance, so a second instance mounted under the same page
 * would enqueue a second job: only the page that owns the Run control leaves `autoEnqueue` on.
 */
export const useCrqSimulationOrchestrator = (
  riskScenarioId: string,
  options?: { autoEnqueue?: boolean },
): CrqSimulationOrchestratorResult => {
  const trpc = useTRPC();
  const autoEnqueue = options?.autoEnqueue ?? true;
  const { toast } = useToast();
  // Ref (not state) so updates don't trigger a re-render that could re-fire the
  // auto-enqueue effect while isFetchingRun is briefly false after job completion.
  const hasEverEnqueuedRef = useRef(false);

  const { data: latestRun, isFetching: isFetchingRun } = useQuery(trpc.crqIndicators.getLatestRun.queryOptions(
    { riskScenarioId },
    { placeholderData: (prev) => prev },
  ));

  const { data: activeSimulation } = useQuery(trpc.crqIndicators.getActiveSimulation.queryOptions(
    { riskScenarioId },
  ));
  const activeJobId = activeSimulation?.jobId ?? null;
  // Undefined covers the first load and a failed read alike: in both, whether a run is in flight is
  // unanswered, and only a click may be withheld — there is no run to claim.
  const isUnknown = activeSimulation === undefined;

  // Only this instance's own run, never the shared read: a control reports the failure of the run
  // it started and of no other, so one failure raises one toast however many controls are mounted,
  // and a stale read handing an old id back cannot re-arm a report already made.
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);

  const { mutate: enqueueSimulation, isPending: isEnqueuePending } = useMutation(trpc.crqIndicators.enqueueSimulation.mutationOptions({
    meta: { skipSuccessToast: true },
    // The active read only catches up a doorbell round trip after this resolves; this id covers
    // the gap.
    onSuccess: ({ jobId }) => {
      setWatchedJobId(jobId);
    },
    onError: () => {
      toast({ description: t`Simulation failed. Please try again.`, variant: 'destructive' });
    },
  }));

  const { isActive: isWatchedRunning } = useJobStatus({
    jobId: watchedJobId,
    onFailed: () => {
      toast({ description: t`Simulation failed. Please try again.`, variant: 'destructive' });
    },
  });

  // Auto-enqueue on first visit when no run exists, and none is already in flight — a second tab's
  // run included, the active read being shared.
  useEffect(() => {
    if (autoEnqueue && !isFetchingRun && !isUnknown && latestRun === null && !activeJobId && !isEnqueuePending && !hasEverEnqueuedRef.current) {
      hasEverEnqueuedRef.current = true;
      // `onlyIfNoRun`: this decision is made on a cached read, and a scenario creation books a run
      // of its own through the recompute it sets off. The server re-checks and answers no job.
      enqueueSimulation({ riskScenarioId, onlyIfNoRun: true });
    }
  }, [autoEnqueue, isFetchingRun, isUnknown, latestRun, activeJobId, isEnqueuePending, enqueueSimulation, riskScenarioId]);

  return {
    isRunning: activeJobId !== null || isWatchedRunning || isEnqueuePending,
    isDisabled: isUnknown,
    onRun: () => {
      hasEverEnqueuedRef.current = true;
      enqueueSimulation({ riskScenarioId });
    },
  };
};
