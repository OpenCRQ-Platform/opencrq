import { newError } from '@app/utils';
import type { EventOrigin, InferRepository } from '../../registry';
import type { AttackerMixture, TechniqueWeight } from '../threat-analyses/technique-weighting';
import type { CatalogTechnique, CuratedTechnique, EmptyEvidenceMode, OutcomeTechniques, RepertoireTechniques } from './outcome-techniques';
import type { MixturePair, ScenarioMixturePair, StoredMixtureRows } from './stored-mixture';
import { defineService } from '../../registry';
import { originTenantId } from '../../security';
import { threatAnalysesService } from '../threat-analyses';
import { organizationsService } from '../organizations';
import { threatRelevanceSettingsService } from '../threat-relevance-settings';
import {
  computeAttackerMixture,
  computeScenarioTechniqueWeights,
  foldToParentTechnique,
} from '../threat-analyses/technique-weighting';
import { attackOutcomesRepository } from './repository';
import {
  buildNoEvidenceResult,
  buildNoRepertoireResult,
  buildOutcomeTechniques,
  buildPendingOutcomeTechniques,
  buildPendingRepertoireTechniques,
  buildRepertoireTechniques,
  selectInferredCandidates,
} from './outcome-techniques';
import { linksOfMixture, mixtureClockOf, mixtureFromRows, mixturePairKey, mixtureToRows, sameStoredMixture } from './stored-mixture';
import { isActiveTechnique } from './technique-filter';

type AttackOutcomesRepo = InferRepository<typeof attackOutcomesRepository>;

/**
 * Which stored mixture the technique weights are read from.
 *
 * `organizationId` is required, and it is the scenario's own organization: country and sector live
 * on `organizations`, not on the tenant, so a tenant spanning several countries has several
 * targeting profiles. Keying the weight on the union over them admits practically every ingested
 * group and disagrees with the Relevant Threats tab, which ranks against a single organization. The
 * published weight is therefore per (attackOutcomeId, organizationId).
 *
 * `tenantId` is required exactly when the origin carries no tenant of its own, such as the `system`
 * origin the platform seed runs under, where the secured views apply no tenant filter: without it
 * the stored mixture would be read across every tenant at once. An origin that carries a tenant
 * wins over it.
 */
export interface OutcomeTechniqueScope {
  organizationId: string,
  tenantId?: string,
}

/**
 * The tenant every read of this service is scoped to. Derived from the origin whenever the origin
 * carries one, so a caller can never widen its own scope by passing an argument; the explicit
 * `tenantId` is the override for origins the secured views do not scope, and its absence there is an
 * error rather than a silent cross-tenant read.
 */
const resolveTenantId = (eventOrigin: EventOrigin, tenantId: string | undefined): string => {
  const resolved = originTenantId(eventOrigin) ?? tenantId;
  if (!resolved) {
    throw newError('Tenant context required to compute attack outcome technique weights');
  }
  return resolved;
};

interface TargetingProfile {
  countryIds: Array<string>,
  sectorIds: Array<string>,
}

/**
 * The stored mixture is read by tenant whatever the origin, so an organization of another tenant
 * would only find no row: this check makes it an error rather than a `no-scenario` answer.
 */
const requireOrganizationOfTenant = (
  organization: { tenantId: string } | undefined,
  organizationId: string,
  tenantId: string,
): void => {
  if (!organization || organization.tenantId !== tenantId) {
    throw newError('Organization does not belong to the tenant context', { organizationId, tenantId });
  }
};

/**
 * Organizations sharing a country and a sector share a targeting profile, so they share every
 * mixture read off it.
 */
const dedupeTargetingProfiles = (
  pairs: ReadonlyArray<ScenarioMixturePair>,
): { profiles: Array<TargetingProfile>, profileIndexByOrganizationId: Map<string, number> } => {
  const profiles: Array<TargetingProfile> = [];
  const profileIndexByKey = new Map<string, number>();
  const profileIndexByOrganizationId = new Map<string, number>();
  for (const { organizationId, countryId, sectorId } of pairs) {
    const profile = { countryIds: countryId ? [countryId] : [], sectorIds: sectorId ? [sectorId] : [] };
    const key = JSON.stringify(profile);
    const profileIndex = profileIndexByKey.get(key) ?? profiles.push(profile) - 1;
    profileIndexByKey.set(key, profileIndex);
    profileIndexByOrganizationId.set(organizationId, profileIndex);
  }
  return { profiles, profileIndexByOrganizationId };
};

/**
 * The stored mixture of a pair, or why there is none: the job writes one for every pair carrying a
 * risk scenario, so a missing row is either on its way or will never come.
 */
const readStoredMixture = async (
  repo: AttackOutcomesRepo,
  tenantId: string,
  pair: MixturePair,
): Promise<AttackerMixture | EmptyEvidenceMode> => {
  const stored = (await repo.findStoredMixtures(tenantId, [pair])).get(mixturePairKey(pair));
  if (stored) {
    return mixtureFromRows(stored);
  }
  return await repo.hasRiskScenarioForPair(tenantId, pair) ? 'mixture-pending' : 'no-scenario';
};

const activeTechniqueIdsOf = (techniques: OutcomeTechniques): Set<string> =>
  new Set(techniques.techniques.filter(isActiveTechnique).map((technique) => technique.mitreTechniqueId));

const weightsOfMixture = (mixture: AttackerMixture): Array<TechniqueWeight> =>
  computeScenarioTechniqueWeights({ mixture, links: linksOfMixture(mixture) });

const loadCatalog = async (
  repo: AttackOutcomesRepo,
  externalIds: Array<string>,
): Promise<Map<string, CatalogTechnique>> => {
  const catalog = await repo.findMitreTechniquesByExternalIds(externalIds);
  return new Map(catalog.map((technique) => [technique.externalId, technique]));
};

const curatedParentIdsOf = (curated: Array<CuratedTechnique>): Set<string> =>
  new Set(curated.map((technique) => foldToParentTechnique(technique.externalId)));

/**
 * Kill-chain membership of every technique the admitted actors carry, for `bindingShare`. One query
 * for the whole batch, on the union of the repertoires: this path runs on every CRQ simulation and
 * every TTPs tab render, and a per-outcome lookup would issue as many round trips as the batch has
 * outcomes.
 */
const loadTacticIds = async (
  repo: AttackOutcomesRepo,
  mixtures: Array<AttackerMixture>,
): Promise<Map<string, Array<string>>> => {
  const externalIds = new Set(mixtures.flatMap((mixture) =>
    mixture.groups.flatMap((group) => group.techniqueExternalIds)));
  const rows = await repo.findTacticIdsByTechniqueExternalIds([...externalIds]);
  const tacticIdsByExternalId = new Map<string, Array<string>>();
  for (const row of rows) {
    const tacticIds = tacticIdsByExternalId.get(row.externalId) ?? [];
    tacticIds.push(row.tacticId);
    tacticIdsByExternalId.set(row.externalId, tacticIds);
  }
  return tacticIdsByExternalId;
};

export const attackOutcomesService = defineService(
  'attackOutcomes',
  attackOutcomesRepository,
).dependsOn(() => [
  threatAnalysesService,
  organizationsService,
  threatRelevanceSettingsService,
]).implement(
  {
    getAttackOutcome: async ({ repo }, ...args: Parameters<AttackOutcomesRepo['findAttackOutcomeById']>) => await repo.findAttackOutcomeById(...args),
    getAttackOutcomes: async ({ repo }) => await repo.findAllAttackOutcomes(),

    /**
     * Technique weights for one attack outcome as seen from one organization, read from the attacker
     * mixture the job stored for that pair: `weight_p` is the share of the admitted,
     * alias-deduplicated actors whose ingested repertoire contains `p`. Ingesting more CTI
     * redistributes shares, it never inflates the total, so vulnerability cannot grow with catalog
     * size alone.
     *
     * A pair with no stored mixture answers `mixture-pending` when it carries a risk scenario, and
     * `no-scenario` with the curated fallback when it does not. See `OutcomeTechniqueScope` for what
     * the caller must supply.
     */
    getMitreTechniquesForOutcome: async (
      { repo, deps, eventOrigin },
      attackOutcomeId: string,
      scope: OutcomeTechniqueScope,
    ): Promise<OutcomeTechniques> => {
      const tenantId = resolveTenantId(eventOrigin, scope.tenantId);
      // Sequential, not `Promise.all`: the platform seed calls this on its transaction's one connection.
      const organization = await deps.organizations.getOrganization(scope.organizationId);
      requireOrganizationOfTenant(organization, scope.organizationId, tenantId);
      const mixture = await readStoredMixture(repo, tenantId, { organizationId: scope.organizationId, attackOutcomeId });
      if (mixture === 'mixture-pending') {
        return buildPendingOutcomeTechniques();
      }
      const curated = await repo.findMitreTechniquesForOutcome(attackOutcomeId);
      if (mixture === 'no-scenario') {
        return buildNoEvidenceResult(curated, 'no-scenario');
      }
      if (mixture.groups.length === 0) {
        return buildNoEvidenceResult(curated, 'no-relevant-threats');
      }
      const weights = weightsOfMixture(mixture);
      const inferredCandidates = selectInferredCandidates(weights, curatedParentIdsOf(curated));
      const catalogByExternalId = await loadCatalog(repo, inferredCandidates.map((weight) => weight.mitreExternalId));
      const tacticIdsByTechniqueExternalId = await loadTacticIds(repo, [mixture]);
      return buildOutcomeTechniques({
        curated,
        mixture,
        weights,
        inferredCandidates,
        catalogByExternalId,
        tacticIdsByTechniqueExternalId,
      });
    },

    /**
     * The same mixture as `getMitreTechniquesForOutcome`, published over the admitted actors' whole
     * observed repertoires instead of the outcome's curated set.
     */
    getRepertoireTechniquesForOutcome: async (
      { repo, deps, eventOrigin },
      attackOutcomeId: string,
      scope: OutcomeTechniqueScope,
    ): Promise<RepertoireTechniques> => {
      const tenantId = resolveTenantId(eventOrigin, scope.tenantId);
      const organization = await deps.organizations.getOrganization(scope.organizationId);
      requireOrganizationOfTenant(organization, scope.organizationId, tenantId);
      const mixture = await readStoredMixture(repo, tenantId, { organizationId: scope.organizationId, attackOutcomeId });
      if (mixture === 'mixture-pending') {
        return buildPendingRepertoireTechniques();
      }
      const curated = await repo.findMitreTechniquesForOutcome(attackOutcomeId);
      if (mixture === 'no-scenario') {
        return buildNoRepertoireResult(curated, 'no-scenario');
      }
      if (mixture.groups.length === 0) {
        return buildNoRepertoireResult(curated, 'no-relevant-threats');
      }
      const weights = weightsOfMixture(mixture);
      const externalIds = weights.map((weight) => weight.mitreExternalId);
      const [catalogByExternalId, tacticRows] = await Promise.all([
        loadCatalog(repo, externalIds),
        repo.findTacticNamesByTechniqueExternalIds(externalIds),
      ]);
      const tacticsByExternalId = new Map<string, Array<{ name: string, order: number }>>();
      for (const row of tacticRows) {
        const tactics = tacticsByExternalId.get(row.externalId) ?? [];
        tactics.push({ name: row.tacticName, order: row.tacticOrder });
        tacticsByExternalId.set(row.externalId, tactics);
      }
      return buildRepertoireTechniques({
        curated,
        mixture,
        weights,
        catalogByExternalId,
        tacticsByExternalId,
      });
    },

    /**
     * Whether `getMitreTechniquesForOutcome` would answer `mixture-pending` for the pair, without
     * reading the mixture itself.
     */
    isAttackerMixturePending: async (
      { repo, deps, eventOrigin },
      attackOutcomeId: string,
      scope: OutcomeTechniqueScope,
    ): Promise<boolean> => {
      const tenantId = resolveTenantId(eventOrigin, scope.tenantId);
      const organization = await deps.organizations.getOrganizationCore(scope.organizationId);
      requireOrganizationOfTenant(organization, scope.organizationId, tenantId);
      const pair = { organizationId: scope.organizationId, attackOutcomeId };
      return !await repo.hasStoredMixture(tenantId, pair) && await repo.hasRiskScenarioForPair(tenantId, pair);
    },

    /**
     * The CRQ-active technique ids (`isActiveTechnique`) of each attack outcome as seen from each
     * organization: the set `getMitreTechniquesForOutcome` publishes, without its display metadata.
     * Every read is issued once for the whole call. A pair with no stored mixture maps to `null`: the
     * pairs asked for come from risk scenarios, so the job has not computed it yet.
     */
    getActiveTechniqueIdsByOrganization: async (
      { repo, deps, eventOrigin },
      outcomeIdsByOrganizationId: ReadonlyMap<string, Array<string>>,
      scope: { tenantId?: string } = {},
    ): Promise<Map<string, Map<string, Set<string> | null>>> => {
      const result = new Map<string, Map<string, Set<string> | null>>();
      if (outcomeIdsByOrganizationId.size === 0) {
        return result;
      }
      const tenantId = resolveTenantId(eventOrigin, scope.tenantId);
      const organizationIds = [...outcomeIdsByOrganizationId.keys()];
      const attackOutcomeIds = [...new Set([...outcomeIdsByOrganizationId.values()].flat())];
      const [curatedRows, organizations] = await Promise.all([
        repo.findMitreTechniquesForOutcomes(attackOutcomeIds),
        Promise.all(organizationIds.map((organizationId) => deps.organizations.getOrganizationCore(organizationId))),
      ]);
      organizationIds.forEach((organizationId, index) => {
        requireOrganizationOfTenant(organizations[index], organizationId, tenantId);
      });

      const pairs = [...outcomeIdsByOrganizationId].flatMap(([organizationId, outcomeIds]) =>
        outcomeIds.map((attackOutcomeId): MixturePair => ({ organizationId, attackOutcomeId })));
      const storedByPair = await repo.findStoredMixtures(tenantId, pairs);

      const curatedByOutcomeId = new Map<string, Array<CuratedTechnique>>();
      for (const row of curatedRows) {
        const rows = curatedByOutcomeId.get(row.attackOutcomeId) ?? [];
        rows.push({
          mitreTechniqueId: row.mitreTechniqueId,
          category: row.category,
          externalId: row.externalId,
          name: row.name,
          revoked: row.revoked,
        });
        curatedByOutcomeId.set(row.attackOutcomeId, rows);
      }

      // Pass 1 resolves every pair's mixture, pass 2 resolves all their inferred candidates against
      // the MITRE catalog in ONE query rather than one per pair.
      const activeIdsByPair = new Map<string, Set<string> | null>();
      const pending = new Map<string, {
        curated: Array<CuratedTechnique>,
        mixture: AttackerMixture,
        weights: Array<TechniqueWeight>,
        inferredCandidates: Array<TechniqueWeight>,
      }>();
      const externalIds = new Set<string>();
      for (const pair of pairs) {
        const key = mixturePairKey(pair);
        if (activeIdsByPair.has(key) || pending.has(key)) {
          continue;
        }
        const stored = storedByPair.get(key);
        if (!stored) {
          activeIdsByPair.set(key, null);
          continue;
        }
        const curated = curatedByOutcomeId.get(pair.attackOutcomeId) ?? [];
        const mixture = mixtureFromRows(stored);
        if (mixture.groups.length === 0) {
          activeIdsByPair.set(key, activeTechniqueIdsOf(buildNoEvidenceResult(curated, 'no-relevant-threats')));
          continue;
        }
        const weights = weightsOfMixture(mixture);
        const inferredCandidates = selectInferredCandidates(weights, curatedParentIdsOf(curated));
        for (const candidate of inferredCandidates) {
          externalIds.add(candidate.mitreExternalId);
        }
        pending.set(key, { curated, mixture, weights, inferredCandidates });
      }

      const catalogByExternalId = await loadCatalog(repo, [...externalIds]);
      for (const [key, entry] of pending) {
        activeIdsByPair.set(key, activeTechniqueIdsOf(buildOutcomeTechniques({
          ...entry,
          catalogByExternalId,
          // Tactics feed only `bindingShare`, display metadata the active set never reads.
          tacticIdsByTechniqueExternalId: new Map(),
        })));
      }

      for (const [organizationId, outcomeIds] of outcomeIdsByOrganizationId) {
        result.set(organizationId, new Map(outcomeIds.map((attackOutcomeId) => [
          attackOutcomeId,
          activeIdsByPair.get(mixturePairKey({ organizationId, attackOutcomeId }))!,
        ])));
      }
      return result;
    },

    /**
     * The only writer of the stored attacker mixtures: one per (organization, attack outcome) pair
     * that carries a risk scenario, computed once per targeting profile and written for every
     * organization sharing it. A pair whose stored mixture is already the computed one is not
     * rewritten, and a stored pair that carries no scenario any more is deleted.
     *
     * Every read is issued on every run, even when nothing changes: a job replaces its observed read
     * set on each run, so a quiet run that skipped one would drop its table from the subscription.
     * Sequential, not `Promise.all`: the platform seed calls this on its transaction's one connection.
     * `at` is passed by the platform seed alone, which dates everything from its own clock.
     */
    recomputeAttackOutcomeMixtures: async (
      { repo, deps, eventOrigin, atomic },
      { at = new Date() }: { at?: Date } = {},
    ): Promise<{ written: number, removed: number, unchanged: number }> => {
      if (eventOrigin.type !== 'job') {
        throw newError('Attack outcome mixtures are recomputed by their job alone', { origin: eventOrigin.type });
      }
      const { tenantId } = eventOrigin;
      const pairs = await repo.findScenarioMixturePairs(tenantId);
      const settings = await deps.threatRelevanceSettings.getThreatRelevanceSettings(tenantId);
      const { profiles, profileIndexByOrganizationId } = dedupeTargetingProfiles(pairs);
      const evidenceByProfile = await deps.threatAnalyses.getAttackerMixtureEvidenceByProfile({
        attackOutcomeIds: [...new Set(pairs.map((pair) => pair.attackOutcomeId))],
        profiles,
        tenantId,
      });
      const stored = await repo.findAllStoredMixtures(tenantId);

      const computedAt = mixtureClockOf(at);
      const mixtureByProfileAndOutcome = new Map<string, AttackerMixture>();
      const computed = new Map<string, StoredMixtureRows>();
      for (const pair of pairs) {
        const profileIndex = profileIndexByOrganizationId.get(pair.organizationId)!;
        const mixtureKey = `${profileIndex}:${pair.attackOutcomeId}`;
        const mixture = mixtureByProfileAndOutcome.get(mixtureKey) ?? computeAttackerMixture({
          groups: evidenceByProfile[profileIndex].get(pair.attackOutcomeId)?.groups ?? [],
          now: computedAt,
          halfLifeObservedDays: settings.actHalfLifeObservedDays,
          halfLifeAuthoredDays: settings.actHalfLifeAuthoredDays,
        });
        mixtureByProfileAndOutcome.set(mixtureKey, mixture);
        computed.set(mixturePairKey(pair), mixtureToRows(tenantId, pair, computedAt, mixture));
      }

      const changed = [...computed]
        .filter(([key, rows]) => {
          const held = stored.get(key);
          return held === undefined || !sameStoredMixture(held, rows);
        })
        .map(([, rows]) => rows);
      const gone = [...stored]
        .filter(([key]) => !computed.has(key))
        .map(([, rows]) => ({ organizationId: rows.mixture.organizationId, attackOutcomeId: rows.mixture.attackOutcomeId }));
      if (changed.length > 0 || gone.length > 0) {
        // A changed pair is replaced whole: a new denominator moves every share of it, so its group
        // rows almost never survive a change unchanged.
        await atomic(async ({ repo: tx }) => {
          await tx.deleteStoredMixtures(tenantId, [...changed.map((rows) => rows.mixture), ...gone]);
          await tx.insertStoredMixtures(changed);
        });
      }
      return { written: changed.length, removed: gone.length, unchanged: computed.size - changed.length };
    },

    /**
     * The curated junction rows for one outcome, unfolded: unlike the mixture-weighted read, this
     * is not deduplicated by parent technique, so a sub-technique curated alongside its parent
     * still shows up as its own row.
     */
    getCuratedMitreTechniquesForOutcome: async ({ repo }, attackOutcomeId: string): Promise<Array<CuratedTechnique>> =>
      repo.findMitreTechniquesForOutcome(attackOutcomeId),

    getAllAttackOutcomeIds: async ({ repo }) => {
      const rows = await repo.findAllAttackOutcomeIds();
      return rows.map((r) => r.id);
    },
  },
);
