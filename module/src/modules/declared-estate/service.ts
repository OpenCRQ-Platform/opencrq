import { uuidv7 } from 'uuidv7';
import type { DeclaredEstateKindComparison } from './comparison';
import type { DeclaredEstateKind } from './constants';
import type { DeclaredEstateAnswer } from './validation';
import { defineService } from '../../registry';
import { originUserId, requireTenantId } from '../../security';
import { organizationsService, RiskScopeNotFoundError } from '../organizations';
import { supportingAssetsService } from '../supporting-assets/service';
import { compareDeclaredEstate } from './comparison';
import { DECLARED_ESTATE_KIND_VALUES } from './constants';
import { declaredEstateRepository } from './repository';

export interface DeclaredEstateKindAnswer {
  readonly kind: DeclaredEstateKind,
  readonly bounds: { readonly low: number, readonly high: number } | null,
  readonly internetFacing: boolean | null,
  readonly setAt: Date | null,
  readonly setByName: string | null,
}

export interface DeclaredEstateEvent {
  readonly id: string,
  readonly kind: DeclaredEstateKind,
  readonly before: { readonly bounds: { readonly low: number, readonly high: number } | null, readonly internetFacing: boolean | null },
  readonly after: { readonly bounds: { readonly low: number, readonly high: number } | null, readonly internetFacing: boolean | null },
  readonly createdAt: Date,
  readonly userName: string | null,
}

export interface DeclaredEstateRow {
  readonly kind: DeclaredEstateKind,
  readonly low: number,
  readonly high: number,
  readonly internetFacing: boolean | null,
}

const boundsOf = (low: number | null, high: number | null) => (low === null || high === null ? null : { low, high });

const sameAnswer = (stored: DeclaredEstateRow | undefined, answer: DeclaredEstateAnswer): boolean => {
  if (stored === undefined || answer.bounds === null) {
    return stored === undefined && answer.bounds === null;
  }
  return stored.low === answer.bounds.low && stored.high === answer.bounds.high && stored.internetFacing === answer.internetFacing;
};

export const DECLARED_ESTATE_HISTORY_LIMIT = 200;

export const declaredEstateService = defineService(
  'declaredEstate',
  declaredEstateRepository,
).dependsOn(() => [organizationsService, supportingAssetsService]).implement({
  /** Every kind, in the questionnaire's order, an unanswered one with null bounds. */
  getDeclaredEstate: async ({ repo }, organizationId: string): Promise<Array<DeclaredEstateKindAnswer>> => {
    const rows = new Map((await repo.findDeclaredEstate(organizationId)).map((row) => [row.kind, row]));
    return DECLARED_ESTATE_KIND_VALUES.map((kind) => {
      const row = rows.get(kind);
      return {
        kind,
        bounds: row === undefined ? null : { low: row.low, high: row.high },
        internetFacing: row?.internetFacing ?? null,
        setAt: row?.setAt ?? null,
        setByName: row?.setByName ?? null,
      };
    });
  },

  getDeclaredEstateRows: async ({ repo }, organizationId: string): Promise<Array<DeclaredEstateRow>> =>
    await repo.findDeclaredEstateAnswers(organizationId),

  /**
   * The assets measured on the scope's estate, or on the whole tenant with no scope, counted into kinds
   * as the engine counts them. The tenant declares nothing of its own, so every kind is undeclared there.
   */
  getDeclaredEstateComparison: async ({ repo, deps }, organizationId: string | null): Promise<{
    kinds: Array<DeclaredEstateKindComparison>,
    declaredAt: Date | null,
  }> => {
    if (organizationId === null) {
      const measured = await deps.supportingAssets.getAssetCountBySubcategoryAndIdentityState(null);
      return { kinds: compareDeclaredEstate([], measured), declaredAt: null };
    }
    const estate = await deps.organizations.resolveEstate(organizationId);
    if (estate === undefined) {
      throw new RiskScopeNotFoundError();
    }
    const [declared, lastChangeAt, measured] = await Promise.all([
      repo.findDeclaredEstateAnswers(organizationId),
      repo.findLastDeclaredEstateChangeAt(organizationId),
      deps.supportingAssets.getAssetCountBySubcategoryAndIdentityState(estate.mode === 'closed' ? organizationId : null),
    ]);
    // A cleared answer leaves no row, so only the journal dates the save that cleared it.
    const declaredAt = declared.length === 0 ? null : lastChangeAt;
    const kinds = compareDeclaredEstate(declared.map((row) => ({ kind: row.kind, bounds: { low: row.low, high: row.high } })), measured);
    return { kinds, declaredAt };
  },

  /** The latest changes first, at most `DECLARED_ESTATE_HISTORY_LIMIT`. */
  getDeclaredEstateHistory: async ({ repo }, organizationId: string): Promise<Array<DeclaredEstateEvent>> =>
    (await repo.findDeclaredEstateEvents(organizationId, DECLARED_ESTATE_HISTORY_LIMIT)).map((row) => ({
      id: row.id,
      kind: row.kind,
      before: { bounds: boundsOf(row.oldLow, row.oldHigh), internetFacing: row.oldInternetFacing },
      after: { bounds: boundsOf(row.newLow, row.newHigh), internetFacing: row.newInternetFacing },
      createdAt: row.createdAt,
      userName: row.userName,
    })),

  /**
   * A partial save: a kind left out keeps its answer, a kind sent with null bounds loses it. Only the
   * kinds that change are written and journaled, so a save repeating the stored answers writes
   * nothing and wakes no recompute.
   */
  saveDeclaredEstate: async ({ atomic, eventOrigin }, organizationId: string, answers: ReadonlyArray<DeclaredEstateAnswer>) => {
    const tenantId = requireTenantId(eventOrigin);
    const userId = originUserId(eventOrigin) ?? null;
    await atomic(async ({ repo }) => {
      if (!await repo.lockScopeForUpdate(organizationId)) {
        throw new RiskScopeNotFoundError();
      }
      const stored = new Map((await repo.findDeclaredEstateAnswers(organizationId)).map((row) => [row.kind, row]));
      const events = [];
      for (const answer of answers) {
        const before = stored.get(answer.kind);
        if (sameAnswer(before, answer)) {
          continue;
        }
        if (answer.bounds === null) {
          await repo.deleteDeclaredEstateAnswer(organizationId, answer.kind);
        } else {
          await repo.upsertDeclaredEstateAnswer({
            tenantId,
            organizationId,
            kind: answer.kind,
            low: answer.bounds.low,
            high: answer.bounds.high,
            internetFacing: answer.internetFacing,
            setByUserId: userId,
          });
        }
        events.push({
          id: uuidv7(),
          tenantId,
          organizationId,
          kind: answer.kind,
          userId,
          oldLow: before?.low ?? null,
          oldHigh: before?.high ?? null,
          oldInternetFacing: before?.internetFacing ?? null,
          newLow: answer.bounds?.low ?? null,
          newHigh: answer.bounds?.high ?? null,
          newInternetFacing: answer.bounds === null ? null : answer.internetFacing,
        });
      }
      await repo.insertDeclaredEstateEvents(events);
    });
  },
});
