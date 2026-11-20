export interface RetryPolicy {
  baseDelayMs: number,
  maxDelayMs: number,
  exponentBase: number,
  jitterMin: number,
  jitterMax: number,
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 1_000,
  maxDelayMs: 5 * 60 * 1_000,
  exponentBase: 2,
  jitterMin: 0.5,
  jitterMax: 1.5,
};

const MAX_SAFE_ATTEMPT = 20;

export const computeRetryDelayMs = (
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number => {
  const safeAttempt = Math.max(0, Math.min(attempt, MAX_SAFE_ATTEMPT));
  const exponential = policy.baseDelayMs * (policy.exponentBase ** safeAttempt);
  const jitter = policy.jitterMin + Math.random() * (policy.jitterMax - policy.jitterMin);
  // Cap applied after jitter so jitterMax can't push past maxDelayMs.
  return Math.min(Math.floor(exponential * jitter), policy.maxDelayMs);
};

export const computeNextRunAfter = (
  attempt: number,
  now: Date = new Date(),
  policy?: RetryPolicy,
): Date => new Date(now.getTime() + computeRetryDelayMs(attempt, policy));

/**
 * A deferred run waits a quarter of its age, counted from its first start, between `minDelayMs`
 * and `maxDelayMs`: inputs a few seconds away are met within seconds, and a long wait costs a few
 * dozen claims rather than one every `minDelayMs`.
 */
export interface DeferralPolicy {
  minDelayMs: number,
  maxDelayMs: number,
  /** Past this age, counted from the run's first start, the run is no longer deferred. */
  maxWaitMs: number,
}

// The awaited job's own time once booked: its wait in the queue and its run.
const AWAITED_JOB_ALLOWANCE_MS = 5 * 60 * 1_000;

/** `bookingCapMs` is the longest the dispatcher takes to book the job a deferred run waits for. */
export const deferralPolicyFor = (bookingCapMs: number): DeferralPolicy => ({
  minDelayMs: 2_000,
  maxDelayMs: 30_000,
  maxWaitMs: bookingCapMs + AWAITED_JOB_ALLOWANCE_MS,
});

export const deferralDelayMs = (ageMs: number, policy: DeferralPolicy): number =>
  Math.ceil(Math.min(policy.maxDelayMs, Math.max(policy.minDelayMs, ageMs / 4)));
