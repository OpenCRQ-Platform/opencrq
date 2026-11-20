import type { MixturePair, ScenarioMixturePair, StoredMixtureGroupRow, StoredMixtureRow, StoredMixtureRows } from './stored-mixture';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { orderByFolded } from '../../db/fold-text';
import { inUuids } from '../../db/uuid-array';
import { chunk } from '../../seed-batch';
import { attackOutcomeMixtureGroups, attackOutcomeMixtures } from './schema';
import { mixturePairKey } from './stored-mixture';

// A group row binds 20 parameters, so 1,000 rows stay far under Postgres' 65,535 limit.
const MIXTURE_WRITE_CHUNK_SIZE = 1000;

const assembleMixtures = (
  parents: ReadonlyArray<StoredMixtureRow>,
  groups: ReadonlyArray<StoredMixtureGroupRow>,
  wanted: ReadonlySet<string> | undefined,
): Map<string, StoredMixtureRows> => {
  const mixtures = new Map<string, StoredMixtureRows>();
  for (const mixture of parents) {
    const key = mixturePairKey(mixture);
    if (wanted === undefined || wanted.has(key)) {
      mixtures.set(key, { mixture, groups: [] });
    }
  }
  for (const group of groups) {
    mixtures.get(mixturePairKey(group))?.groups.push(group);
  }
  return mixtures;
};

export const attackOutcomesRepository = defineRepository({
  findAttackOutcomeById: async ({ db, views }, id: string) => (await db
    .select()
    .from(views.attackOutcomes)
    .where(eq(views.attackOutcomes.id, id))
    .limit(1)).at(0),
  findAllAttackOutcomes: ({ db, views }) => db.select().from(views.attackOutcomes).orderBy(...orderByFolded(views.attackOutcomes.nameFolded, views.attackOutcomes.name, false)),
  findAllAttackOutcomeIds: async ({ db, views }) =>
    db.select({ id: views.attackOutcomes.id }).from(views.attackOutcomes),

  // --- MITRE Technique junction methods ---
  findMitreTechniquesForOutcome: async ({ db, views }, attackOutcomeId: string) =>
    db.select({
      mitreTechniqueId: views.attackOutcomeMitreTechniques.mitreTechniqueId,
      category: views.attackOutcomeMitreTechniques.category,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      revoked: views.mitreTechniques.revoked,
    })
      .from(views.attackOutcomeMitreTechniques)
      .innerJoin(views.mitreTechniques, eq(views.attackOutcomeMitreTechniques.mitreTechniqueId, views.mitreTechniques.id))
      .where(eq(views.attackOutcomeMitreTechniques.attackOutcomeId, attackOutcomeId)),

  findMitreTechniquesForOutcomes: async ({ db, views }, attackOutcomeIds: Array<string>) => {
    if (attackOutcomeIds.length === 0) {
      return [];
    }
    return db.select({
      attackOutcomeId: views.attackOutcomeMitreTechniques.attackOutcomeId,
      mitreTechniqueId: views.attackOutcomeMitreTechniques.mitreTechniqueId,
      category: views.attackOutcomeMitreTechniques.category,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      revoked: views.mitreTechniques.revoked,
    })
      .from(views.attackOutcomeMitreTechniques)
      .innerJoin(views.mitreTechniques, eq(views.attackOutcomeMitreTechniques.mitreTechniqueId, views.mitreTechniques.id))
      .where(inArray(views.attackOutcomeMitreTechniques.attackOutcomeId, attackOutcomeIds));
  },

  // Catalog lookup for the inferred set: the mixture yields MITRE external ids (the ingested
  // repertoire is keyed by them), the CRQ engine and every UI surface need the catalog uuid.
  // Sub-techniques never appear here: the mixture folds every link to its parent first.
  findMitreTechniquesByExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return [];
    }
    return db.select({
      mitreTechniqueId: views.mitreTechniques.id,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      revoked: views.mitreTechniques.revoked,
    })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.externalId, externalIds));
  },

  // Kill-chain membership of the ingested repertoires, for `bindingShare`: whether blocking a
  // technique actually denies an actor a stage, or only makes it reach for another technique it
  // already owns at the same stage. Keyed by external id because a repertoire is a set of external
  // ids, and a technique belongs to several tactics, so this is many rows per technique.
  findTacticIdsByTechniqueExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return [];
    }
    return db.select({
      externalId: views.mitreTechniques.externalId,
      tacticId: views.mitreTechniqueTactics.tacticId,
    })
      .from(views.mitreTechniqueTactics)
      .innerJoin(views.mitreTechniques, eq(views.mitreTechniqueTactics.techniqueId, views.mitreTechniques.id))
      .where(inArray(views.mitreTechniques.externalId, externalIds));
  },

  // Separate from the lookup above, which runs on every CRQ simulation and every capability render
  // and needs the ids alone: this one joins the tactic rows for their names and serves one tab.
  findTacticNamesByTechniqueExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return [];
    }
    return db.select({
      externalId: views.mitreTechniques.externalId,
      tacticName: views.mitreTactics.name,
      tacticOrder: views.mitreTactics.order,
    })
      .from(views.mitreTechniqueTactics)
      .innerJoin(views.mitreTechniques, eq(views.mitreTechniqueTactics.techniqueId, views.mitreTechniques.id))
      .innerJoin(views.mitreTactics, eq(views.mitreTechniqueTactics.tacticId, views.mitreTactics.id))
      .where(inArray(views.mitreTechniques.externalId, externalIds));
  },

  // --- Attacker mixtures stored per (organization, attack outcome) ---

  // Explicit `tenantId` filters on every read below: under a `system` origin the views filter nothing.
  findScenarioMixturePairs: async ({ db, views }, tenantId: string): Promise<Array<ScenarioMixturePair>> =>
    db.selectDistinct({
      organizationId: views.riskScenarios.organizationId,
      attackOutcomeId: views.riskScenarios.attackOutcomeId,
      countryId: views.organizations.countryId,
      sectorId: views.organizations.sectorId,
    }).from(views.riskScenarios)
      .innerJoin(views.organizations, and(
        eq(views.organizations.id, views.riskScenarios.organizationId),
        eq(views.organizations.tenantId, views.riskScenarios.tenantId),
      ))
      .where(eq(views.riskScenarios.tenantId, tenantId)),

  hasRiskScenarioForPair: async ({ db, views }, tenantId: string, pair: MixturePair): Promise<boolean> =>
    (await db.select({ one: sql<number>`1` }).from(views.riskScenarios)
      .where(and(
        eq(views.riskScenarios.tenantId, tenantId),
        eq(views.riskScenarios.organizationId, pair.organizationId),
        eq(views.riskScenarios.attackOutcomeId, pair.attackOutcomeId),
      ))
      .limit(1)).length > 0,

  hasStoredMixture: async ({ db, views }, tenantId: string, pair: MixturePair): Promise<boolean> =>
    (await db.select({ one: sql<number>`1` }).from(views.attackOutcomeMixtures)
      .where(and(
        eq(views.attackOutcomeMixtures.tenantId, tenantId),
        eq(views.attackOutcomeMixtures.organizationId, pair.organizationId),
        eq(views.attackOutcomeMixtures.attackOutcomeId, pair.attackOutcomeId),
      ))
      .limit(1)).length > 0,

  // The pairs come from the tenant's scenarios, so their organizations and outcomes grow with the
  // estate: they bind as uuid arrays. The arrays select a superset of the pairs (the cross
  // product), narrowed to the exact pairs here.
  findStoredMixtures: async ({ db, views }, tenantId: string, pairs: ReadonlyArray<MixturePair>): Promise<Map<string, StoredMixtureRows>> => {
    if (pairs.length === 0) {
      return new Map();
    }
    const organizationIds = [...new Set(pairs.map((pair) => pair.organizationId))];
    const attackOutcomeIds = [...new Set(pairs.map((pair) => pair.attackOutcomeId))];
    // Sequential, not `Promise.all`: the platform seed reads these on its transaction's one connection.
    const parents = await db.select().from(views.attackOutcomeMixtures).where(and(
      eq(views.attackOutcomeMixtures.tenantId, tenantId),
      inUuids(views.attackOutcomeMixtures.organizationId, organizationIds),
      inUuids(views.attackOutcomeMixtures.attackOutcomeId, attackOutcomeIds),
    ));
    const groups = await db.select().from(views.attackOutcomeMixtureGroups).where(and(
      eq(views.attackOutcomeMixtureGroups.tenantId, tenantId),
      inUuids(views.attackOutcomeMixtureGroups.organizationId, organizationIds),
      inUuids(views.attackOutcomeMixtureGroups.attackOutcomeId, attackOutcomeIds),
    ));
    return assembleMixtures(parents, groups, new Set(pairs.map(mixturePairKey)));
  },

  findAllStoredMixtures: async ({ db, views }, tenantId: string): Promise<Map<string, StoredMixtureRows>> => {
    const parents = await db.select().from(views.attackOutcomeMixtures).where(eq(views.attackOutcomeMixtures.tenantId, tenantId));
    const groups = await db.select().from(views.attackOutcomeMixtureGroups).where(eq(views.attackOutcomeMixtureGroups.tenantId, tenantId));
    return assembleMixtures(parents, groups, undefined);
  },

  // Parents go first, since a group's foreign key names its parent. Plain inserts: the certified
  // overwrite renders on the jsonb payload path, which carries no array column.
  insertStoredMixtures: async ({ db }, rows: ReadonlyArray<StoredMixtureRows>): Promise<void> => {
    for (const batch of chunk(rows.map((row) => row.mixture), MIXTURE_WRITE_CHUNK_SIZE)) {
      await db.insert(attackOutcomeMixtures).values(batch);
    }
    for (const batch of chunk(rows.flatMap((row) => row.groups), MIXTURE_WRITE_CHUNK_SIZE)) {
      await db.insert(attackOutcomeMixtureGroups).values(batch);
    }
  },

  // The foreign key cascades the delete to the pair's groups.
  deleteStoredMixtures: async ({ db }, tenantId: string, pairs: ReadonlyArray<MixturePair>): Promise<void> => {
    await db.delete(attackOutcomeMixtures).where(and(
      eq(attackOutcomeMixtures.tenantId, tenantId),
      sql`(${attackOutcomeMixtures.organizationId}, ${attackOutcomeMixtures.attackOutcomeId}) in (select * from unnest(${sql.param(pairs.map((pair) => pair.organizationId))}::uuid[], ${sql.param(pairs.map((pair) => pair.attackOutcomeId))}::uuid[]))`,
    ));
  },
});
