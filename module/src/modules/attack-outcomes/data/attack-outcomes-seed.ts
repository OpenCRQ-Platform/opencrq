import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { SeedFunction } from '../../../seed-registry';
import type { AttackOutcomeReference } from './attack-outcomes-data';
import { deriveSeedId } from '../../../seed-ids';
import { registerSeed } from '../../../seed-registry';
// Evaluated first so the ATT&CK seed registers, and runs, before this one: a deployment seeds once
// per app version, so a technique the catalog starts citing has to exist when this seeder links it.
import '../../mitre-attack/data/mitre-attack-seed';
import { mitreTechniquesData } from '../../mitre-attack/data/mitre-techniques';
import { tenants } from '../../tenants/schema';
import { attackOutcomeMitreTechniques, attackOutcomes } from '../schema';
import { ATTACK_OUTCOMES } from './attack-outcomes-data';

/**
 * The tenant's attack-outcome rows, derived from {@link ATTACK_OUTCOMES}.
 * Every row id comes from the catalog UUID through {@link deriveSeedId}, so the same tenant
 * always rebuilds the same rows and no caller ever resolves an entry by name or position.
 */
export const buildAttackOutcomeRows = (tenantId: string): Array<typeof attackOutcomes.$inferInsert> => (
  ATTACK_OUTCOMES.map((outcome) => ({
    id: deriveSeedId(tenantId, outcome.id),
    tenantId,
    name: outcome.name,
    description: outcome.description,
    referenceDwellDays: outcome.referenceDwellDays,
    terminalTactic: outcome.terminalTacticExternalId,
    reachesAvailability: outcome.criteriaReached.availability,
    reachesIntegrity: outcome.criteriaReached.integrity,
    reachesConfidentiality: outcome.criteriaReached.confidentiality,
    reachesTraceability: outcome.criteriaReached.traceability,
  }))
);

/**
 * The reverse of the derivation above: given a tenant's `attack_outcomes.id` row, find which
 * catalog UUID (from `attack-outcomes-ids.ts`) it was derived from — the id `tef-catalog`'s
 * `baseRates` is keyed on. `undefined` for a row that isn't one of the seeded
 * catalog outcomes (should not happen for a platform-seeded tenant).
 */
export const outcomeCatalogId = (tenantId: string, rowId: string): string | undefined =>
  ATTACK_OUTCOMES.find((outcome) => deriveSeedId(tenantId, outcome.id) === rowId)?.id;

const TECHNIQUE_ID_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique.id]));

/**
 * The MITRE techniques an outcome curates, resolved against the vendored dataset.
 * External ids the dataset does not carry are skipped, and a technique listed twice keeps its first
 * category, so `signature` wins over `related` and the result never collides on the junction key.
 */
const resolveOutcomeTechniques = (outcome: AttackOutcomeReference): Array<{ mitreTechniqueId: string, category: 'signature' | 'related' }> => {
  const resolved = new Map<string, { mitreTechniqueId: string, category: 'signature' | 'related' }>();
  const curated = [
    ...outcome.signatureTechniqueExternalIds.map((externalId) => ({ externalId, category: 'signature' as const })),
    ...outcome.relatedTechniqueExternalIds.map((externalId) => ({ externalId, category: 'related' as const })),
  ];
  for (const { externalId, category } of curated) {
    const mitreTechniqueId = TECHNIQUE_ID_BY_EXTERNAL_ID.get(externalId);
    if (mitreTechniqueId && !resolved.has(mitreTechniqueId)) {
      resolved.set(mitreTechniqueId, { mitreTechniqueId, category });
    }
  }
  return [...resolved.values()];
};

/**
 * The tenant's outcome/technique junction rows, derived from {@link ATTACK_OUTCOMES}.
 * The single place where the catalog's technique external ids are resolved: the tenant bootstrap
 * and the boot seeder both build their rows here, so they can never diverge.
 */
export const buildAttackOutcomeTechniqueRows = (tenantId: string): Array<typeof attackOutcomeMitreTechniques.$inferInsert> => (
  ATTACK_OUTCOMES.flatMap((outcome) => {
    const attackOutcomeId = deriveSeedId(tenantId, outcome.id);
    return resolveOutcomeTechniques(outcome).map((technique) => ({ attackOutcomeId, ...technique }));
  })
);

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const outcomeUpdate = {
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  referenceDwellDays: sql`excluded.reference_dwell_days`,
  terminalTactic: sql`excluded.terminal_tactic`,
  reachesAvailability: sql`excluded.reaches_availability`,
  reachesIntegrity: sql`excluded.reaches_integrity`,
  reachesConfidentiality: sql`excluded.reaches_confidentiality`,
  reachesTraceability: sql`excluded.reaches_traceability`,
};
const outcomeDiverged = sql`${attackOutcomes.name} IS DISTINCT FROM excluded.name
  OR ${attackOutcomes.description} IS DISTINCT FROM excluded.description
  OR ${attackOutcomes.referenceDwellDays} IS DISTINCT FROM excluded.reference_dwell_days
  OR ${attackOutcomes.terminalTactic} IS DISTINCT FROM excluded.terminal_tactic
  OR ${attackOutcomes.reachesAvailability} IS DISTINCT FROM excluded.reaches_availability
  OR ${attackOutcomes.reachesIntegrity} IS DISTINCT FROM excluded.reaches_integrity
  OR ${attackOutcomes.reachesConfidentiality} IS DISTINCT FROM excluded.reaches_confidentiality
  OR ${attackOutcomes.reachesTraceability} IS DISTINCT FROM excluded.reaches_traceability`;

const techniqueCategoryUpdate = { category: sql`excluded.category` };
const techniqueCategoryDiverged = sql`${attackOutcomeMitreTechniques.category} IS DISTINCT FROM excluded.category`;

/**
 * Reprovisions the closed attack-outcome catalog and the outcome/technique junction it owns into
 * every tenant on boot. Rows are keyed by the deterministic id derived from the catalog entry, so
 * editing the reference and rebooting is the whole update procedure. The junction matters on its
 * own: a wiped `attack_outcomes` table would otherwise leave it empty forever and break every CRQ
 * run. This seeder links the MITRE techniques but never writes them, that is the MITRE seed's job.
 */
export const seedAttackOutcomes: SeedFunction = async (db) => {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  if (allTenants.length === 0) {
    return;
  }

  for (const tenant of allTenants) {
    const outcomeRows = buildAttackOutcomeRows(tenant.id);
    const techniqueRows = buildAttackOutcomeTechniqueRows(tenant.id);

    await db.insert(attackOutcomes).values(outcomeRows)
      .onConflictDoUpdate({ target: attackOutcomes.id, set: outcomeUpdate, setWhere: outcomeDiverged });

    // The junction has no updatable payload beyond `category`, so the upsert exists only to move a
    // pair that changed side between `signature` and `related`.
    if (techniqueRows.length > 0) {
      await db.insert(attackOutcomeMitreTechniques).values(techniqueRows)
        .onConflictDoUpdate({
          target: [attackOutcomeMitreTechniques.attackOutcomeId, attackOutcomeMitreTechniques.mitreTechniqueId],
          set: techniqueCategoryUpdate,
          setWhere: techniqueCategoryDiverged,
        });
    }

    /*
     * Prune what left the reference, junction first. When tenant editing is unlocked, this delete
     * must skip rows the tenant owns, which is why the unlock needs a provenance marker on the row.
     * The junction delete is scoped to this tenant's derived outcome ids and then to the pairs the
     * catalog no longer curates, so no other tenant and no other outcome can ever be reached.
     */
    const curatedPairs = techniqueRows.map((row) => sql`(${row.attackOutcomeId}::uuid, ${row.mitreTechniqueId}::uuid)`);
    await db.delete(attackOutcomeMitreTechniques).where(and(
      inArray(attackOutcomeMitreTechniques.attackOutcomeId, outcomeRows.map((row) => row.id)),
      curatedPairs.length > 0
        ? sql`(${attackOutcomeMitreTechniques.attackOutcomeId}, ${attackOutcomeMitreTechniques.mitreTechniqueId}) NOT IN (${sql.join(curatedPairs, sql`, `)})`
        : undefined,
    ));
    await db.delete(attackOutcomes)
      .where(and(eq(attackOutcomes.tenantId, tenant.id), notInArray(attackOutcomes.id, outcomeRows.map((row) => row.id))));
  }
};

registerSeed(seedAttackOutcomes);
