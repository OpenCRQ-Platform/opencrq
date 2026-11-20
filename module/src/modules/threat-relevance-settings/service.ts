import { newError } from '@app/utils';
import type { ThreatRelevanceSettings, ThreatRelevanceSettingsValues } from './validation';
import { defineService } from '../../registry';
import { originTenantId } from '../../security';
import { THREAT_RELEVANCE_DEFAULTS } from './constants';
import { threatRelevanceSettingsRepository } from './repository';
import { threatRelevanceSettingsSchema } from './validation';

export const threatRelevanceSettingsService = defineService(
  'threatRelevanceSettings',
  threatRelevanceSettingsRepository,
).implement({
  /**
   * `tenantId` is the override for origins that carry no tenant of their own, such as the `system`
   * origin the platform seed runs under. Omitting it there throws rather than falling back to the hardcoded
   * defaults, so a job-side read of another tenant's gate fails loudly instead of scoring on 60.
   * An origin that carries its own tenant wins over it.
   */
  getThreatRelevanceSettings: async ({ repo, eventOrigin }, tenantId?: string): Promise<ThreatRelevanceSettings> => {
    const resolvedTenantId = originTenantId(eventOrigin) ?? tenantId;
    if (!resolvedTenantId) {
      throw newError('Tenant context required to read threat relevance settings');
    }
    const row = await repo.findByTenantId(resolvedTenantId);
    if (!row) {
      return { ...THREAT_RELEVANCE_DEFAULTS };
    }
    return {
      actHalfLifeObservedDays: row.actHalfLifeObservedDays,
      actHalfLifeAuthoredDays: row.actHalfLifeAuthoredDays,
      confidenceGate: row.confidenceGate,
      unknownActivityAgeDays: row.unknownActivityAgeDays,
    };
  },

  updateThreatRelevanceSettings: async ({ repo, eventOrigin }, values: ThreatRelevanceSettingsValues) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const parsed = threatRelevanceSettingsSchema.safeParse(values);
    if (!parsed.success) {
      throw newError('Invalid threat relevance settings', {
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }
    await repo.upsertSettings({
      tenantId: eventOrigin.tenantId,
      actHalfLifeObservedDays: parsed.data.actHalfLifeObservedDays,
      actHalfLifeAuthoredDays: parsed.data.actHalfLifeAuthoredDays,
      confidenceGate: parsed.data.confidenceGate,
      unknownActivityAgeDays: parsed.data.unknownActivityAgeDays,
    });
  },
});
