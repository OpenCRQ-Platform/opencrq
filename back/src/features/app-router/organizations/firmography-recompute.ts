import type { EventOrigin, TriggeredBy } from '@app/module';
import { originTrigger } from '@app/module';
import { createLogger } from '../../../utils/logger';

const { logFromError } = createLogger({ feature: 'firmography-recompute' });

/** The firmography fields `resolveAutoTef` reads; a change here can move an auto-mode scenario's TEF. */
export const FIRMOGRAPHY_FIELDS = ['sectorId', 'countryId', 'revenueBand', 'employeeCount'] as const;

export interface OrganizationFirmographySnapshot {
  tenantId: string,
  sectorId: string | null,
  countryId: string | null,
  revenueBand: string | null,
  employeeCount: number | null,
}

/** A stable string identifying a firmography value: used as the `tef-recompute` job's idempotency key suffix. */
const firmographyVersion = (org: OrganizationFirmographySnapshot): string =>
  FIRMOGRAPHY_FIELDS.map((field) => String(org[field])).join('|');

interface TefRecomputeJob {
  kind: string,
  tenantId: string,
  payload: { riskScenarioId: string },
  idempotencyKey: string,
  triggeredBy: TriggeredBy,
  triggeredById?: string,
  interactive: boolean,
}

interface RecomputeServices {
  riskScenarios: { getAutoModeRiskScenarioIds: (organizationId: string) => Promise<ReadonlyArray<string>> },
  jobs: { enqueueJob: (job: TefRecomputeJob) => Promise<unknown> },
}

/**
 * Books one `tef-recompute` per auto-mode scenario of the organization, and only when the
 * firmography actually moved. Every write that can change a firmography field owes this call: the
 * revenue band is one of those fields and the questionnaire's Q1 derives it, so a profile save
 * reaches an auto-mode TEF exactly as an organization edit does.
 *
 * Async enqueue only, and each enqueue is caught on its own: one scenario's failure must not roll
 * back the write that already succeeded, nor block the other scenarios' jobs.
 */
export const enqueueTefRecomputeOnFirmographyChange = async (
  services: RecomputeServices,
  origin: EventOrigin,
  organizationId: string,
  before: OrganizationFirmographySnapshot | null | undefined,
  after: OrganizationFirmographySnapshot | null | undefined,
): Promise<void> => {
  if (!after || (before && firmographyVersion(before) === firmographyVersion(after))) {
    return;
  }
  const version = firmographyVersion(after);
  const autoModeScenarioIds = await services.riskScenarios.getAutoModeRiskScenarioIds(organizationId);
  await Promise.all(autoModeScenarioIds.map((riskScenarioId) =>
    services.jobs.enqueueJob({
      kind: 'tef-recompute',
      tenantId: after.tenantId,
      payload: { riskScenarioId },
      idempotencyKey: `tef-recompute-${riskScenarioId}-${version}`,
      ...originTrigger(origin),
      // The save that moved the firmography is the one whose result the page is about to show.
      interactive: true,
    }).catch((error: unknown) => {
      logFromError(error, 'Failed to enqueue tef-recompute job', { riskScenarioId });
    })));
};
