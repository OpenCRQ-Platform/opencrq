import { newError, StructuredError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { ExtractPublicFromDef, InferRepository, ServiceContext } from '../../registry';
import type { EstimateWriteEntry, RecomputedDriverValue, ScenarioEstimatesFingerprint } from './write-plan-utils';
import type { SanityWarning } from '../loss-drivers';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { resolveCatalogueAttackOutcomeId } from '../attack-outcomes';
import { resolveCatalogueBusinessValueCategoryId } from '../business-value-categories';
import { resolveCountryIsoAlpha3 } from '../countries';
import { declaredEstateService } from '../declared-estate';
import { financialProfilesService } from '../financial-profiles';
import {
  deriveEstimates,
  deriveTenantLossDriverId,
  evaluateTotalSanity,
  financialProfileToKernelInput,
  organizationToKernelInput,
} from '../loss-drivers';
import { organizationsService } from '../organizations';
import { riskScenariosService } from '../risk-scenarios';
import { computePertExpectedValue } from './pert';
import { scenarioLossEstimatesRepository } from './repository';
import { isStaleWrite, planBackfillWrite, planManualWrite, planRecomputeWrite, planStaleQuestionnaireDeletes } from './write-plan-utils';

/** Thrown when a save's fingerprint no longer matches the scenario's current rows — a concurrent write raced it. */
export class StaleWriteError extends StructuredError {
  override readonly name: string = 'StaleWriteError';

  override readonly reason: string = 'STALE_WRITE';

  constructor(riskScenarioId: string) {
    super('Scenario loss estimates have changed since they were last read', { data: { riskScenarioId } });
  }
}

/** Thrown when a save asks to revert a driver the scenario's current profile no longer derives. */
export class UnrevertableEstimateError extends StructuredError {
  override readonly name: string = 'UnrevertableEstimateError';

  constructor(riskScenarioId: string, lossDriverIds: ReadonlyArray<string>) {
    super('No automatic value is available for these loss drivers', { data: { riskScenarioId, lossDriverIds } });
  }
}

const isCompleteEstimate = <T extends { minValue: number | null, likelyValue: number | null, maxValue: number | null }>(
  estimate: T,
): estimate is T & { minValue: number, likelyValue: number, maxValue: number } =>
  estimate.minValue !== null && estimate.likelyValue !== null && estimate.maxValue !== null;

type Repo = InferRepository<typeof scenarioLossEstimatesRepository>;

interface Deps {
  riskScenarios: ExtractPublicFromDef<typeof riskScenariosService>,
  declaredEstate: ExtractPublicFromDef<typeof declaredEstateService>,
  financialProfiles: ExtractPublicFromDef<typeof financialProfilesService>,
  organizations: ExtractPublicFromDef<typeof organizationsService>,
}

interface ScenarioDerivation {
  organizationId: string,
  estimates: ReadonlyArray<RecomputedDriverValue>,
  coefficientSetVersion: string,
  /** Read before the derivation's inputs, stamped after them: a save landing meanwhile is not claimed covered. */
  answersVersion: string,
}

/**
 * The plausibility verdict on the total the scenario page displays. Judged on the displayed
 * figures rather than on a fresh derivation, because manual rows are part of what the reader is
 * looking at and are the ones no formula has vetted.
 *
 * A scenario with no profile, or with no priced row at all, has nothing to be judged against and
 * returns no verdict rather than a reassuring one. A total that genuinely comes to zero is still
 * judged: an explicit refusal posture priced against a declared incident is exactly the case the
 * under-pricing warning exists for.
 */
const evaluateDisplayedTotalSanity = async (
  deps: Deps,
  riskScenarioId: string,
  expectedTotalUsd: number,
  pricedRowCount: number,
): Promise<ReadonlyArray<SanityWarning>> => {
  if (pricedRowCount === 0) {
    return [];
  }
  const organizationId = await deps.riskScenarios.getScenarioOrganizationId(riskScenarioId);
  if (!organizationId) {
    return [];
  }
  const [profile, organization] = await Promise.all([
    deps.financialProfiles.getFinancialProfile(organizationId),
    deps.organizations.getOrganizationCore(organizationId),
  ]);
  if (!profile || !organization) {
    return [];
  }
  return evaluateTotalSanity(
    { annualRevenueUsd: profile.annualRevenue, costliestIncidentBand: profile.costliestIncidentBand },
    organizationToKernelInput(organization),
    expectedTotalUsd,
  );
};

/**
 * Re-derives a scenario's estimates from its organization's current financial profile and declared
 * workstations and servers: its own activation set crossed with the profile mapped to the kernel's
 * input shape, translating each emitted catalogue driver id into the tenant's real row id. A missing profile or scenario is a
 * no-op, never an error — the caller decides what "no-op" means for it.
 */
const loadScenarioDerivation = async (
  deps: Deps,
  tenantId: string,
  riskScenarioId: string,
): Promise<ScenarioDerivation | null> => {
  const activationContext = await deps.riskScenarios.getScenarioActivationContext(riskScenarioId);
  if (!activationContext) {
    return null;
  }
  // Read before every input below, and never after: a save committing mid-derivation then leaves
  // the stamp behind answers it did not cover, so the notice stays up and the follow-up that save
  // books is what clears it. Read last, the same save would be claimed covered by amounts derived
  // before it, and the notice would go down over figures one save behind.
  const answersVersion = await deps.financialProfiles.getAnswersVersion(activationContext.organizationId);
  if (answersVersion === undefined) {
    return null;
  }
  const profile = await deps.financialProfiles.getFinancialProfile(activationContext.organizationId);
  if (!profile) {
    return null;
  }
  const organization = await deps.organizations.getOrganizationCore(activationContext.organizationId);
  if (!organization) {
    return null;
  }
  const declaredEstate = await deps.declaredEstate.getDeclaredEstateRows(activationContext.organizationId);

  // The kernel's activation matrix is keyed by catalogue id (it is pure and carries no tenant
  // context), while the scenario's own attack outcome and loss-scope business-value categories
  // are stored as this tenant's real row ids — the inverse of the driver-id translation below.
  const catalogueCells = activationContext.activationSet.flatMap((cell) => {
    const catalogueAttackOutcomeId = resolveCatalogueAttackOutcomeId(tenantId, cell.attackOutcomeId);
    const catalogueBusinessValueCategoryId = resolveCatalogueBusinessValueCategoryId(tenantId, cell.businessValueCategoryId);
    return catalogueAttackOutcomeId && catalogueBusinessValueCategoryId
      ? [{ attackOutcomeCatalogId: catalogueAttackOutcomeId, businessValueCategoryCatalogId: catalogueBusinessValueCategoryId }]
      : [];
  });

  // Distinguishes "this scenario genuinely activates nothing" from "resolution is broken." The
  // latter aborts the derivation entirely rather than proceeding with a partial activation set:
  // a partial set would silently derive too few (or zero) estimates and, downstream, delete every
  // existing `questionnaire` row the missing cells would otherwise have kept alive.
  if (catalogueCells.length < activationContext.activationSet.length) {
    // eslint-disable-next-line no-console -- module has no access to back's structured logger; this is its own diagnostic trail for an otherwise-silent resolution failure
    console.warn(
      `[scenario-loss-estimates] scenario ${riskScenarioId}: ${activationContext.activationSet.length - catalogueCells.length}/${activationContext.activationSet.length} activation cells failed catalogue-id resolution`,
    );
    return null;
  }

  const result = deriveEstimates(
    financialProfileToKernelInput(profile, declaredEstate),
    // The country picks the labour-cost benchmark D1.4 falls back to when the rate is left blank.
    organizationToKernelInput({ ...organization, countryIsoAlpha3: resolveCountryIsoAlpha3(tenantId, organization.countryId) }),
    catalogueCells,
  );

  return {
    organizationId: activationContext.organizationId,
    coefficientSetVersion: result.coefficientSetVersion,
    answersVersion,
    estimates: result.estimates.map((estimate) => ({
      lossDriverId: deriveTenantLossDriverId(tenantId, estimate.lossDriverCatalogId),
      minValue: estimate.min,
      likelyValue: estimate.likely,
      maxValue: estimate.max,
      lowConfidence: estimate.lowConfidence,
      isPosture: estimate.isPosture ?? false,
    })),
  };
};

type Atomic = ServiceContext<Repo, Deps>['atomic'];

/**
 * `changed` is whether any amount actually moved, which is not the same as having run: an
 * unchanged derivation writes nothing. It is what the CRQ fan-out keys on, so a questionnaire edit
 * only re-simulates the scenarios whose loss magnitude it really shifted.
 */
interface ScenarioRecomputeOutcome {
  recomputed: boolean,
  changed: boolean,
}

/**
 * One transaction per scenario: writes only rows with no prior row or a `questionnaire`
 * provenance, using an upsert whose conflict update is itself guarded to `questionnaire` so a
 * manual save racing this same transaction always wins. Deletes a `questionnaire` row for a driver
 * the kernel no longer emits, so a cleared answer does not leave a stale derived figure behind.
 *
 * In `backfillOnly` mode (the periodic/boot-time catch-up, never an explicit recompute), a driver
 * with any existing row — whatever its provenance or model version — is left untouched instead:
 * only a genuinely missing row is written, and no row is deleted. A catch-up that pruned would
 * make an unattended timer destructive on a profile the reader never touched. This is what lets that catch-up run safely even after a
 * coefficient-set version bump, since new coefficients must only apply through an explicit
 * recompute. `coefficientSetVersion` is stamped on the profile in full mode only — a backfill run
 * does not claim the profile was derived under the new set when most of its rows were left alone.
 */
const recomputeScenario = async (
  ctx: { atomic: Atomic, deps: Deps },
  tenantId: string,
  riskScenarioId: string,
  options: { backfillOnly: boolean },
): Promise<ScenarioRecomputeOutcome> => {
  const derivation = await loadScenarioDerivation(ctx.deps, tenantId, riskScenarioId);
  if (!derivation) {
    return { recomputed: false, changed: false };
  }

  let changed = false;
  await ctx.atomic(async ({ repo: atomicRepo, deps: atomicDeps }) => {
    const existingRows = await atomicRepo.findRowsForScenario(riskScenarioId);
    const existingByDriverId = new Map(existingRows.map((row) => [row.lossDriverId, row]));

    for (const estimate of derivation.estimates) {
      const existing = existingByDriverId.get(estimate.lossDriverId);
      const step = options.backfillOnly
        ? planBackfillWrite(estimate, existing, derivation.coefficientSetVersion, uuidv7)
        : planRecomputeWrite(estimate, existing, derivation.coefficientSetVersion, false, uuidv7);
      if (step.kind === 'upsert') {
        const written = await atomicRepo.upsertQuestionnaireRow({ ...step, riskScenarioId, updatedAt: new Date() });
        // Two reasons a planned upsert is not an amount change: the guard may have dropped it in
        // favour of a manual save that landed first, and the plan also upserts when only the model
        // version or the posture flag moved. Either would re-simulate figures nobody sees move.
        changed = changed
          || (written && (
            !existing
            || existing.minValue !== step.minValue
            || existing.likelyValue !== step.likelyValue
            || existing.maxValue !== step.maxValue
          ));
      }
    }

    if (!options.backfillOnly) {
      const emittedDriverIds = new Set(derivation.estimates.map((estimate) => estimate.lossDriverId));
      for (const lossDriverId of planStaleQuestionnaireDeletes(existingRows, emittedDriverIds)) {
        // A driver that stopped being activated changes the total as surely as one that moved —
        // but the delete is guarded on provenance, so a manual save that took the row over since
        // `existingRows` was read keeps it, and nothing moved.
        const removed = await atomicRepo.deleteQuestionnaireRow(riskScenarioId, lossDriverId);
        changed = changed || removed;
      }
      await atomicDeps.financialProfiles.stampCoefficientSetVersion(derivation.organizationId, derivation.coefficientSetVersion);
      // Stamped in the transaction that wrote this scenario's rows, so the claim covers this
      // scenario and no other: a sibling still queued, or failing, leaves this one's figures
      // correctly described as current.
      await atomicDeps.riskScenarios.markEstimatesDerived(riskScenarioId, derivation.answersVersion);
    }
  });

  return { recomputed: true, changed };
};

/**
 * Whether the answers have moved on since this scenario's own amounts were derived.
 *
 * It rides on the summary rather than on a read of its own so the verdict and the figures it
 * qualifies travel in one response: a separate query reading `jobs` refetched on every unrelated
 * job of the tenant and cleared itself long before the amounts on screen were refreshed.
 */
const isRecomputePending = async (deps: Deps, riskScenarioId: string): Promise<boolean> =>
  await deps.riskScenarios.isEstimatesRecomputePending(riskScenarioId);

export const scenarioLossEstimatesService = defineService(
  'scenarioLossEstimates',
  scenarioLossEstimatesRepository,
).dependsOn(() => [riskScenariosService, declaredEstateService, financialProfilesService, organizationsService]).implement({
  /** `lowConfidence` is the kernel's own verdict, carried onto the row at derivation time; a `manual` row never reports one. */
  getScenarioLossEstimates: async ({ repo }, riskScenarioId: string, validOnly: boolean = false) => {
    const rows = await repo.findByScenarioId(riskScenarioId, validOnly);
    return rows.map((row) => ({ ...row, lowConfidence: row.provenance === 'questionnaire' && row.lowConfidence }));
  },

  /**
   * A keyed upsert on `(riskScenarioId, lossDriverId)`, never delete-all-then-reinsert: a row
   * absent from `entries` is left untouched. `expected` is the fingerprint the client read off the
   * rows it holds; a mismatch (including "the client read no rows yet") rejects the whole write
   * before anything is changed.
   *
   * `revertLossDriverIds` are taken back to their derived figures in the same transaction and under
   * the same fingerprint, so a revert can neither skip the staleness check nor land on a manual
   * value written between two calls. A named driver with no derived figure rejects the whole write.
   */
  upsertScenarioLossEstimates: async (
    { atomic, eventOrigin, deps },
    riskScenarioId: string,
    entries: ReadonlyArray<EstimateWriteEntry>,
    expected: ScenarioEstimatesFingerprint,
    revertLossDriverIds: ReadonlyArray<string> = [],
  ) => {
    const payloadLossDriverIds = [...entries.map((entry) => entry.lossDriverId), ...revertLossDriverIds];
    const seenLossDriverIds = new Set<string>();
    for (const lossDriverId of payloadLossDriverIds) {
      if (seenLossDriverIds.has(lossDriverId)) {
        throw newError('Duplicate loss driver id in payload', { riskScenarioId, lossDriverId });
      }
      seenLossDriverIds.add(lossDriverId);
    }

    const derivation = revertLossDriverIds.length > 0
      ? await loadScenarioDerivation(deps, requireTenantId(eventOrigin), riskScenarioId)
      : null;
    const derivedByDriverId = new Map((derivation?.estimates ?? []).map((estimate) => [estimate.lossDriverId, estimate]));
    const unrevertable = revertLossDriverIds.filter((lossDriverId) => !derivedByDriverId.has(lossDriverId));
    if (unrevertable.length > 0) {
      throw new UnrevertableEstimateError(riskScenarioId, unrevertable);
    }
    const revertEstimates = revertLossDriverIds.flatMap((lossDriverId) => derivedByDriverId.get(lossDriverId) ?? []);
    const coefficientSetVersion = derivation?.coefficientSetVersion ?? '';

    await atomic(async ({ repo: atomicRepo }) => {
      await atomicRepo.validateRiskScenarioId(riskScenarioId);
      await atomicRepo.validateLossDriverIds(payloadLossDriverIds);
      // Closes the race between the staleness check below and this transaction's own write: an
      // unlocked read would let two concurrent saves both pass the same check.
      await atomicRepo.lockScenarioForUpdate(riskScenarioId);

      const current = await atomicRepo.findScenarioEstimatesFingerprint(riskScenarioId);
      if (isStaleWrite(expected, current)) {
        throw new StaleWriteError(riskScenarioId);
      }

      const existingRows = await atomicRepo.findRowsForScenario(riskScenarioId);
      const existingByDriverId = new Map(existingRows.map((row) => [row.lossDriverId, row]));

      for (const entry of entries) {
        const step = planManualWrite(entry, existingByDriverId.get(entry.lossDriverId), uuidv7);
        if (step.kind === 'upsert') {
          await atomicRepo.upsertRow({ ...step, riskScenarioId, updatedAt: new Date() });
        } else if (step.kind === 'delete') {
          await atomicRepo.deleteRow(riskScenarioId, step.lossDriverId);
        }
      }

      for (const estimate of revertEstimates) {
        const step = planRecomputeWrite(estimate, existingByDriverId.get(estimate.lossDriverId), coefficientSetVersion, true, uuidv7);
        if (step.kind === 'upsert') {
          await atomicRepo.upsertRow({ ...step, riskScenarioId, updatedAt: new Date() });
        }
      }
    });
  },

  getFinancialSummary: async ({ repo, deps }, riskScenarioId: string) => {
    // Read before the figures, not after: the two are separate statements, and a recompute
    // committing between them may then only make a fresh total read as still pending, never a
    // stale total read as settled.
    const recomputePending = await isRecomputePending(deps, riskScenarioId);
    const estimates = await repo.findByScenarioId(riskScenarioId, true);

    let totalMin = 0;
    let totalLikely = 0;
    let totalMax = 0;
    for (const est of estimates) {
      totalMin += est.minValue!;
      totalLikely += est.likelyValue!;
      totalMax += est.maxValue!;
    }

    const pertExpectedValue = totalMin > 0 || totalLikely > 0 || totalMax > 0
      ? computePertExpectedValue(totalMin, totalLikely, totalMax)
      : 0;

    const updatedAt = estimates.length > 0
      ? estimates.reduce((max, e) => e.updatedAt > max ? e.updatedAt : max, estimates[0].updatedAt)
      : null;

    return {
      totalMinDollar: totalMin,
      totalLikelyDollar: totalLikely,
      totalMaxDollar: totalMax,
      pertExpectedValue,
      updatedAt,
      sanityWarnings: await evaluateDisplayedTotalSanity(deps, riskScenarioId, pertExpectedValue, estimates.length),
      recomputePending,
    };
  },

  /**
   * Which kinds of loss carry the cost of this outcome: the PERT expected value of every recorded
   * estimate, summed per driver, across EVERY scenario naming the outcome — priced or not, since a
   * hand-recorded estimate does not depend on a simulation existing.
   *
   * `findByScenarioIds`'s own `validOnly` drops a row unless it satisfies the same rule
   * `findByScenarioId` enforces for a single scenario, so the two can never disagree on which
   * estimates count.
   */
  getLossDriverSplitForOutcome: async ({ repo, deps }, attackOutcomeId: string) => {
    const scenarios = await deps.riskScenarios.findRiskScenariosByAttackOutcomeIds([attackOutcomeId]);
    if (scenarios.length === 0) {
      return { drivers: [], total: 0 };
    }

    const estimates = await repo.findByScenarioIds(scenarios.map((scenario) => scenario.id), true);
    // Keyed on the driver id, never its name: two drivers of different categories may share a
    // label, and merging them would invent a cost neither carries.
    const byDriverId = new Map<string, { driverId: string, driver: string, amount: number }>();
    for (const estimate of estimates.filter(isCompleteEstimate)) {
      const expectedValue = computePertExpectedValue(estimate.minValue, estimate.likelyValue, estimate.maxValue);
      const current = byDriverId.get(estimate.lossDriverId);
      if (current) {
        current.amount += expectedValue;
      } else {
        byDriverId.set(estimate.lossDriverId, { driverId: estimate.lossDriverId, driver: estimate.lossDriverName, amount: expectedValue });
      }
    }

    const drivers = [...byDriverId.values()]
      .sort((a, b) => (b.amount - a.amount) || a.driver.localeCompare(b.driver) || a.driverId.localeCompare(b.driverId));
    return { drivers, total: drivers.reduce((sum, row) => sum + row.amount, 0) };
  },

  /** The job handler's single-scenario path, asked for one named scenario rather than a whole tenant. */
  recomputeQuestionnaireEstimatesForScenario: async ({ atomic, eventOrigin, deps }, riskScenarioId: string): Promise<ScenarioRecomputeOutcome> => {
    const tenantId = requireTenantId(eventOrigin);
    return await recomputeScenario({ atomic, deps }, tenantId, riskScenarioId, { backfillOnly: false });
  },

  /**
   * The tenant-wide sweep every automatic trigger resolves to, since the dispatcher's own routing
   * can only ask for the whole tenant. One scenario's failure does not abort the rest.
   *
   * `backfillOnly` is the periodic/boot-time catch-up's own flag (see `recomputeScenario`): it
   * exists so that run can never apply a newer coefficient set to an already-derived row. `signal`
   * is checked between scenarios, not only before the sweep starts, so a cancellation, timeout or
   * shutdown stops the sweep promptly instead of running the rest of a possibly long tenant.
   *
   * Each scenario stamps its own coverage inside its own transaction, so a failure here is a
   * failure for that scenario alone: its siblings keep the amounts they just derived, described as
   * current, and only the one that did not go through still reads as stale. A backfill stamps
   * nothing — it leaves already-derived rows alone, so it has refreshed nothing it could vouch for.
   */
  recomputeQuestionnaireEstimates: async (
    { atomic, eventOrigin, deps },
    options: { backfillOnly?: boolean, signal?: AbortSignal } = {},
  ): Promise<{ recomputedScenarios: number, failedScenarios: number, changedScenarioIds: Array<string> }> => {
    const tenantId = requireTenantId(eventOrigin);
    const backfillOnly = options.backfillOnly ?? false;
    const organizationIdsWithProfile = await deps.financialProfiles.getOrganizationIdsWithProfile();

    const scenarios = organizationIdsWithProfile.length > 0
      ? await deps.riskScenarios.getRiskScenarioIdsByOrganizationIds(organizationIdsWithProfile)
      : [];

    let recomputedScenarios = 0;
    let failedScenarios = 0;
    // Named, not counted: the caller re-simulates exactly these, which is what keeps a save on one
    // risk scope from booking a run for every scenario of the tenant.
    const changedScenarioIds: Array<string> = [];
    for (const scenario of scenarios) {
      if (options.signal?.aborted) {
        continue;
      }
      try {
        const { recomputed, changed } = await recomputeScenario({ atomic, deps }, tenantId, scenario.id, { backfillOnly });
        if (recomputed) {
          recomputedScenarios += 1;
        }
        if (changed) {
          changedScenarioIds.push(scenario.id);
        }
      } catch (error) {
        failedScenarios += 1;
        // eslint-disable-next-line no-console -- module has no access to back's structured logger; this is the sweep's own diagnostic trail for an otherwise-silent per-scenario failure
        console.error(`[scenario-loss-estimates] failed to recompute scenario ${scenario.id}`, error);
      }
    }

    return { recomputedScenarios, failedScenarios, changedScenarioIds };
  },

  /**
   * What a revert would write, read without writing, since a manual row keeps no automatic
   * value of its own. Empty when there is nothing to derive from.
   */
  getAutomaticEstimates: async ({ eventOrigin, deps }, riskScenarioId: string): Promise<ReadonlyArray<RecomputedDriverValue>> => {
    const derivation = await loadScenarioDerivation(deps, requireTenantId(eventOrigin), riskScenarioId);
    return derivation?.estimates ?? [];
  },
});
