import { newError } from '@app/utils';
import type { UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { DeclaredCriticality } from '../supporting-assets/constants';
import { defineService } from '../../registry';
import { originTenantId } from '../../security';
import { FINDING_SCORE_SETTING_DEFAULTS } from '../finding-score/constants';
import { isMeasuredInFuture } from './phishing-declaration';
import { crqIndicatorSettingsRepository } from './repository';

/**
 * Upper bound on the per-tenant iteration count, enforced here and at the router.
 *
 * The setting multiplies every evaluation of a run, and the attack run engine's per-world cost grows
 * with the actors' repertoires, so nothing else in the chain defends against a tenant typing twenty
 * thousand. The bound belongs on the setting rather than on the engine.
 *
 * The value is the budget divided by the worst shape the platform ships. Measured at 25 to 51
 * microseconds per chain evaluation, a scenario with eleven actors at ninety-five techniques costs
 * roughly a minute and a half of CPU per thousand worlds, against a safe budget near four minutes:
 * four concurrent jobs interleave on one event loop, so the fifteen-minute wall clock is not the
 * ceiling. Two thousand leaves that shape inside the budget with the default of a thousand still
 * doubled. A higher ceiling passed the wall clock and quietly missed the budget.
 */
export const MAX_CRQ_ITERATIONS = 2000;

export const CRQ_INDICATOR_DEFAULTS = {
  iterations: 1000,
  exposureWeightInternetFacing: 1.0,
  exposureWeightInternal: 0.4,
  susceptibilityGamma: 0.7,
  ...FINDING_SCORE_SETTING_DEFAULTS,
  unknownExposureCountsAs: 'internal' satisfies UnknownExposureCountsAs,
  phishingFailureRate: null as number | null,
  phishingFailureMeasuredOn: null as string | null,
} as const;

export const crqIndicatorSettingsService = defineService(
  'crqIndicatorSettings',
  crqIndicatorSettingsRepository,
).implement({
  getCrqIndicatorSettings: async ({ repo, eventOrigin }) => {
    const tenantId = originTenantId(eventOrigin);
    if (!tenantId) {
      return { ...CRQ_INDICATOR_DEFAULTS };
    }
    const row = await repo.findByTenantId(tenantId);
    if (!row) {
      return { ...CRQ_INDICATOR_DEFAULTS };
    }
    return {
      iterations: row.iterations,
      exposureWeightInternetFacing: row.exposureWeightInternetFacing,
      exposureWeightInternal: row.exposureWeightInternal,
      susceptibilityGamma: row.susceptibilityGamma,
      measuredValidityDays: row.measuredValidityDays,
      unknownCriticalityCountsAs: row.unknownCriticalityCountsAs,
      unknownExposureCountsAs: row.unknownExposureCountsAs,
      phishingFailureRate: row.phishingFailureRate,
      phishingFailureMeasuredOn: row.phishingFailureMeasuredOn,
    };
  },

  updateCrqIndicatorSettings: async ({ repo, eventOrigin }, values: {
    iterations?: number,
    exposureWeightInternetFacing?: number,
    exposureWeightInternal?: number,
    susceptibilityGamma?: number,
    measuredValidityDays?: number | null,
    unknownCriticalityCountsAs?: DeclaredCriticality,
    unknownExposureCountsAs?: UnknownExposureCountsAs,
    /** Given with `phishingFailureMeasuredOn`, or not at all; both null clears the declaration. */
    phishingFailureRate?: number | null,
    phishingFailureMeasuredOn?: string | null,
  }) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    // A rate is read as measured on a day, so the stored pair never holds one without the other.
    if ((values.phishingFailureRate === undefined) !== (values.phishingFailureMeasuredOn === undefined)
      || (values.phishingFailureRate === null) !== (values.phishingFailureMeasuredOn === null)) {
      throw newError('A phishing failure rate and the day it was measured are given together, or cleared together');
    }
    if (typeof values.phishingFailureMeasuredOn === 'string' && isMeasuredInFuture(values.phishingFailureMeasuredOn, new Date())) {
      throw newError('A campaign cannot be measured in the future');
    }
    const existing = await repo.findByTenantId(eventOrigin.tenantId);
    await repo.upsertSettings({
      tenantId: eventOrigin.tenantId,
      iterations: Math.min(values.iterations ?? existing?.iterations ?? CRQ_INDICATOR_DEFAULTS.iterations, MAX_CRQ_ITERATIONS),
      exposureWeightInternetFacing: values.exposureWeightInternetFacing ?? existing?.exposureWeightInternetFacing ?? CRQ_INDICATOR_DEFAULTS.exposureWeightInternetFacing,
      exposureWeightInternal: values.exposureWeightInternal ?? existing?.exposureWeightInternal ?? CRQ_INDICATOR_DEFAULTS.exposureWeightInternal,
      susceptibilityGamma: values.susceptibilityGamma ?? existing?.susceptibilityGamma ?? CRQ_INDICATOR_DEFAULTS.susceptibilityGamma,
      // Null is the value that turns the window off, so an omitted key is the only thing that may
      // fall back to what is stored.
      measuredValidityDays: values.measuredValidityDays !== undefined
        ? values.measuredValidityDays
        : existing?.measuredValidityDays ?? CRQ_INDICATOR_DEFAULTS.measuredValidityDays,
      unknownCriticalityCountsAs: values.unknownCriticalityCountsAs
        ?? existing?.unknownCriticalityCountsAs
        ?? CRQ_INDICATOR_DEFAULTS.unknownCriticalityCountsAs,
      unknownExposureCountsAs: values.unknownExposureCountsAs
        ?? existing?.unknownExposureCountsAs
        ?? CRQ_INDICATOR_DEFAULTS.unknownExposureCountsAs,
      // Null clears the declaration, so only an omitted key falls back to what is stored.
      phishingFailureRate: values.phishingFailureRate !== undefined
        ? values.phishingFailureRate
        : existing?.phishingFailureRate ?? CRQ_INDICATOR_DEFAULTS.phishingFailureRate,
      phishingFailureMeasuredOn: values.phishingFailureMeasuredOn !== undefined
        ? values.phishingFailureMeasuredOn
        : existing?.phishingFailureMeasuredOn ?? CRQ_INDICATOR_DEFAULTS.phishingFailureMeasuredOn,
    });
  },
});
