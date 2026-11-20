import { uuidv7 } from 'uuidv7';
import type { JournalValue } from '../../db/journal-value';
import type { financialProfileEvents, financialProfiles } from './schema';
import type { FinancialProfileAnswerField } from './validation';
import { decodeJournalValue, encodeJournalValue } from '../../db/journal-value';
import { defineService } from '../../registry';
import { originUserId, requireTenantId } from '../../security';
import { deriveRevenueBand, SCOPE_EVENTS_LIMIT } from '../organizations/constants';
import { organizationsService, RiskScopeNotFoundError } from '../organizations';
import { financialProfilesRepository } from './repository';
import { FINANCIAL_PROFILE_ANSWER_FIELDS } from './validation';

/** The saveable answer columns: every question-set field plus the header's editable default. */
export type FinancialProfileAnswers = Omit<
  typeof financialProfiles.$inferInsert,
  'id' | 'tenantId' | 'organizationId' | 'coefficientSetVersion' | 'updatedAt'
>;

/**
 * A card's detail fields behind a closed boolean gate are stale, not an answer: the UI already
 * clears them on click, but a request built by hand could still carry them, so the same clearing
 * is re-applied here before anything is persisted.
 */
const normalizeGatedAnswers = (answers: FinancialProfileAnswers): FinancialProfileAnswers => {
  let normalized = answers;
  if (normalized.recordsHeldGate === false) {
    normalized = { ...normalized, individualsBand: null };
  }
  if (normalized.outOfBandVerificationGate === false) {
    normalized = { ...normalized, outOfBandThreshold: null };
  }
  if (normalized.ransomPaymentPosture === false) {
    normalized = { ...normalized, ransomPaymentCeiling: null };
  }
  return normalized;
};

export interface FinancialProfileEvent {
  readonly id: string,
  readonly field: FinancialProfileAnswerField,
  readonly before: JournalValue,
  readonly after: JournalValue,
  readonly createdAt: Date,
  readonly userName: string | null,
}

type StoredAnswers = Partial<Record<FinancialProfileAnswerField, string | number | boolean | null>>;

/** One event per answer the save changes; an answer the save leaves out keeps its stored value. */
const answerEvents = (
  stored: StoredAnswers | undefined,
  answers: FinancialProfileAnswers,
  scope: { tenantId: string, organizationId: string, userId: string | null },
): Array<typeof financialProfileEvents.$inferInsert> => FINANCIAL_PROFILE_ANSWER_FIELDS.flatMap((field) => {
  const before = encodeJournalValue(stored?.[field] ?? null);
  const sent = answers[field];
  const after = sent === undefined ? before : encodeJournalValue(sent);
  return before === after ? [] : [{ id: uuidv7(), ...scope, field, oldValue: before, newValue: after }];
});

export const financialProfilesService = defineService(
  'financialProfiles',
  financialProfilesRepository,
).dependsOn(() => [organizationsService]).implement({
  getFinancialProfile: async ({ repo }, organizationId: string) =>
    (await repo.findFinancialProfileByOrganizationId(organizationId)) ?? null,

  getOrganizationIdsWithProfile: async ({ repo }) => await repo.findOrganizationIdsWithProfile(),

  /** The version a derivation stamps itself against; `undefined` when the organization has no profile. */
  getAnswersVersion: async ({ repo }, organizationId: string) => await repo.findAnswersVersion(organizationId),

  getFinancialProfileHistory: async ({ repo }, organizationId: string): Promise<Array<FinancialProfileEvent>> =>
    (await repo.findFinancialProfileEvents(organizationId, SCOPE_EVENTS_LIMIT)).map((row) => ({
      id: row.id,
      field: row.field,
      before: decodeJournalValue(row.oldValue),
      after: decodeJournalValue(row.newValue),
      createdAt: row.createdAt,
      userName: row.userName,
    })),

  /**
   * `annualRevenue` and the organization's `revenueBand` are kept in sync from the write side
   * only: an amount saved here rewrites the band when the amount changes, never the reverse, so
   * answers saved with the amount untouched leave a band chosen elsewhere alone. A scope the caller
   * cannot see is refused here rather than by the profile's policy, whose refusal is a bare error.
   */
  saveFinancialProfile: async ({ atomic, eventOrigin }, organizationId: string, rawAnswers: FinancialProfileAnswers) => {
    const tenantId = requireTenantId(eventOrigin);
    const userId = originUserId(eventOrigin) ?? null;
    const answers = normalizeGatedAnswers(rawAnswers);

    await atomic(async ({ repo: atomicRepo, deps }) => {
      if (!await atomicRepo.lockScopeForUpdate(organizationId)) {
        throw new RiskScopeNotFoundError();
      }
      const existing = await atomicRepo.findFinancialProfileByOrganizationId(organizationId);
      await atomicRepo.insertFinancialProfileEvents(answerEvents(existing, answers, { tenantId, organizationId, userId }));
      await atomicRepo.upsertFinancialProfile({
        id: existing?.id ?? uuidv7(),
        tenantId,
        organizationId,
        ...answers,
        updatedAt: new Date(),
      });

      const storedRevenue = existing?.annualRevenue ?? null;
      // An answer left out keeps its stored value, so it cannot move the band.
      const annualRevenue = answers.annualRevenue === undefined ? storedRevenue : answers.annualRevenue;
      if (annualRevenue !== storedRevenue) {
        await deps.organizations.updateOrganization(organizationId, {
          revenueBand: annualRevenue === null ? null : deriveRevenueBand(annualRevenue),
        });
      }
    });
  },

  stampCoefficientSetVersion: async ({ repo }, organizationId: string, coefficientSetVersion: string) =>
    await repo.updateCoefficientSetVersion(organizationId, coefficientSetVersion),

});
