import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib';

const TERMINAL_STATUSES = ['succeeded', 'dlq', 'cancelled'] as const;
type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

const isTerminal = (status: string | null | undefined): status is TerminalStatus =>
  status != null && (TERMINAL_STATUSES as ReadonlyArray<string>).includes(status);

interface UseJobStatusOptions {
  /** The job ID to watch. Pass `null` to disable. */
  jobId: string | null,
  /** Called once when the job reaches `succeeded`. */
  onSuccess?: () => void,
  /** Called once when the job reaches `dlq` or `cancelled`. */
  onFailed?: () => void,
}

interface UseJobStatusResult {
  /** Current job status, or `null` if no job is being watched. */
  status: string | null,
  /** Whether a job is actively in progress (queued or running). */
  isActive: boolean,
}

/**
 * Watches a job's status via the SSE-powered query cache.
 * The `data_changed` SSE event invalidates `jobs.getJob` automatically.
 */
export const useJobStatus = ({
  jobId,
  onSuccess,
  onFailed,
}: UseJobStatusOptions): UseJobStatusResult => {
  const trpc = useTRPC();
  // Stable refs so callbacks never need to be in effect deps — avoids
  // re-firing when the parent re-renders with a new inline function reference.
  // useLayoutEffect (not useEffect) guarantees the refs are updated synchronously
  // after the DOM commit, before any passive effects run that may read them.
  const onSuccessRef = useRef(onSuccess);
  const onFailedRef = useRef(onFailed);
  const hasCalledRef = useRef(false);
  useLayoutEffect(() => {
    onSuccessRef.current = onSuccess;
    onFailedRef.current = onFailed;
  });

  const { data: job } = useQuery(trpc.jobs.getJob.queryOptions(
    { id: jobId! },
    { enabled: jobId !== null },
  ));

  const status = job?.status ?? null;

  useEffect(() => {
    if (!isTerminal(status) || hasCalledRef.current) {
      return;
    }
    hasCalledRef.current = true;
    if (status === 'succeeded') {
      onSuccessRef.current?.();
    } else {
      onFailedRef.current?.();
    }
  }, [status]);

  // Reset the guard whenever the watched job changes so that a fresh job
  // correctly fires its callback even if a previous one already did.
  useEffect(() => {
    hasCalledRef.current = false;
  }, [jobId]);

  return {
    status,
    isActive: jobId !== null && !isTerminal(status),
  };
};
