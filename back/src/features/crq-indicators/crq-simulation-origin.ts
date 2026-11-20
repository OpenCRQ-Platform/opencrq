import type { CrqRunProfile, EventOrigin } from '@app/module';

/**
 * The third shape carries no identity on purpose: a run the platform decided on — a loss estimate
 * the questionnaire recompute rewrote — has no person behind it, and naming one would be a lie in
 * the run's own provenance.
 *
 * A payload without a profile was booked before runs had one, and booked a full run.
 */
export type CrqBaselinePayload = (
  | { riskScenarioId: string, userId: string }
  | { riskScenarioId: string, serviceAccountId: string }
  | { riskScenarioId: string }
) & { profile?: CrqRunProfile };

/**
 * Who a simulation runs as. Its own module so it can be tested without the database engine the
 * handler pulls in: an identityless payload used to fall through to the connector branch and build
 * a `service_accounts` predicate on an undefined id, which Postgres rejected as malformed.
 */
export const crqRunOrigin = (payload: CrqBaselinePayload, tenantId: string, jobKind: string, interactive: boolean): EventOrigin => {
  // Carried on all three shapes: a run borrowing a person's origin still has to say which run it
  // is, or its writes reach the doorbell as that person's own edit.
  const job = { jobKind, interactive };
  return 'userId' in payload
    ? { type: 'client', userId: payload.userId, tenantId, job }
    : ('serviceAccountId' in payload
      ? { type: 'connector', serviceAccountId: payload.serviceAccountId, tenantId, job }
      : { type: 'job', tenantId, jobKind, interactive });
};
