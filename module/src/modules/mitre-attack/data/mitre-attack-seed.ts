import { notInArray, sql } from 'drizzle-orm';
import type { MitreTechniqueData } from './mitre-techniques';
import { chunk, dedupeBy } from '../../../seed-batch';
import { registerSeed } from '../../../seed-registry';
import { mitreMitigations, mitreMitigationTechniques, mitreTactics, mitreTechniques, mitreTechniqueTactics } from '../schema';
import { mitreMitigationsData } from './mitre-mitigations';
import { mitreTacticsData } from './mitre-tactics';
import { mitreTechniquesData } from './mitre-techniques';

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const tacticUpdate = {
  externalId: sql`excluded.external_id`,
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  url: sql`excluded.url`,
  order: sql`excluded."order"`,
};
const tacticDiverged = sql`${mitreTactics.externalId} IS DISTINCT FROM excluded.external_id
  OR ${mitreTactics.name} IS DISTINCT FROM excluded.name
  OR ${mitreTactics.description} IS DISTINCT FROM excluded.description
  OR ${mitreTactics.url} IS DISTINCT FROM excluded.url
  OR ${mitreTactics.order} IS DISTINCT FROM excluded."order"`;

const techniqueUpdate = {
  externalId: sql`excluded.external_id`,
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  url: sql`excluded.url`,
  parentTechniqueId: sql`excluded.parent_technique_id`,
  isSubtechnique: sql`excluded.is_subtechnique`,
  revoked: sql`excluded.revoked`,
  replacedByTechniqueId: sql`excluded.replaced_by_technique_id`,
};
const techniqueDiverged = sql`${mitreTechniques.externalId} IS DISTINCT FROM excluded.external_id
  OR ${mitreTechniques.name} IS DISTINCT FROM excluded.name
  OR ${mitreTechniques.description} IS DISTINCT FROM excluded.description
  OR ${mitreTechniques.url} IS DISTINCT FROM excluded.url
  OR ${mitreTechniques.parentTechniqueId} IS DISTINCT FROM excluded.parent_technique_id
  OR ${mitreTechniques.isSubtechnique} IS DISTINCT FROM excluded.is_subtechnique
  OR ${mitreTechniques.revoked} IS DISTINCT FROM excluded.revoked
  OR ${mitreTechniques.replacedByTechniqueId} IS DISTINCT FROM excluded.replaced_by_technique_id`;

const mitigationUpdate = {
  externalId: sql`excluded.external_id`,
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  url: sql`excluded.url`,
};
const mitigationDiverged = sql`${mitreMitigations.externalId} IS DISTINCT FROM excluded.external_id
  OR ${mitreMitigations.name} IS DISTINCT FROM excluded.name
  OR ${mitreMitigations.description} IS DISTINCT FROM excluded.description
  OR ${mitreMitigations.url} IS DISTINCT FROM excluded.url`;

const techniqueRow = (tech: MitreTechniqueData) => ({
  id: tech.id,
  externalId: tech.externalId,
  name: tech.name,
  description: tech.description,
  url: tech.url,
  parentTechniqueId: tech.parentTechniqueId,
  isSubtechnique: tech.isSubtechnique,
  revoked: tech.revoked,
  replacedByTechniqueId: tech.replacedByTechniqueId,
});

registerSeed(async (db) => {
  // FK phases must stay ordered: a technique may reference a parent or a replacement technique.
  const upsertTechniques = async (techniques: Array<MitreTechniqueData>) => {
    for (const rows of chunk(dedupeBy(techniques, (tech) => tech.id))) {
      await db
        .insert(mitreTechniques)
        .values(rows.map(techniqueRow))
        .onConflictDoUpdate({ target: mitreTechniques.id, set: techniqueUpdate, setWhere: techniqueDiverged });
    }
  };

  // 1. Upsert tactics
  for (const rows of chunk(dedupeBy(mitreTacticsData, (tactic) => tactic.id))) {
    await db
      .insert(mitreTactics)
      .values(rows)
      .onConflictDoUpdate({ target: mitreTactics.id, set: tacticUpdate, setWhere: tacticDiverged });
  }

  const activeTechniques = mitreTechniquesData.filter((t) => !t.revoked);
  const revokedTechniques = mitreTechniquesData.filter((t) => t.revoked);

  // 2. Upsert active parent techniques first (FK: parentTechniqueId, replacedByTechniqueId must reference existing rows)
  await upsertTechniques(activeTechniques.filter((t) => !t.isSubtechnique));

  // 3. Upsert active sub-techniques (can now reference active parents)
  await upsertTechniques(activeTechniques.filter((t) => t.isSubtechnique));

  // 4. Upsert revoked parent techniques (replacedByTechniqueId references active techniques inserted above)
  await upsertTechniques(revokedTechniques.filter((t) => !t.isSubtechnique));

  // 5. Upsert revoked sub-techniques (can reference active parents and replacements)
  await upsertTechniques(revokedTechniques.filter((t) => t.isSubtechnique));

  // 6. Upsert technique-tactic junctions
  const techniqueTacticRows = mitreTechniquesData.flatMap((tech) =>
    tech.tacticIds.map((tacticId) => ({ techniqueId: tech.id, tacticId })));
  for (const rows of chunk(techniqueTacticRows)) {
    await db.insert(mitreTechniqueTactics).values(rows).onConflictDoNothing();
  }

  // 7. Upsert mitigations
  const mitigationRows = mitreMitigationsData.map((mitigation) => ({
    id: mitigation.id,
    externalId: mitigation.externalId,
    name: mitigation.name,
    description: mitigation.description,
    url: mitigation.url,
  }));
  for (const rows of chunk(dedupeBy(mitigationRows, (mitigation) => mitigation.id))) {
    await db
      .insert(mitreMitigations)
      .values(rows)
      .onConflictDoUpdate({ target: mitreMitigations.id, set: mitigationUpdate, setWhere: mitigationDiverged });
  }

  // 8. Upsert mitigation-technique junctions
  const mitigationTechniqueRows = mitreMitigationsData.flatMap((mitigation) =>
    mitigation.techniqueIds.map((techniqueId) => ({ mitigationId: mitigation.id, techniqueId })));
  for (const rows of chunk(mitigationTechniqueRows)) {
    await db.insert(mitreMitigationTechniques).values(rows).onConflictDoNothing();
  }

  // 9. Cleanup stale technique-tactic junctions (rows pointing to techniques no longer in dataset)
  const allTechIds = mitreTechniquesData.map((t) => t.id);
  await db.delete(mitreTechniqueTactics).where(notInArray(mitreTechniqueTactics.techniqueId, allTechIds));

  // 10. Cleanup stale mitigation-technique junctions
  await db.delete(mitreMitigationTechniques).where(notInArray(mitreMitigationTechniques.techniqueId, allTechIds));

  // 11. Mark techniques no longer in current dataset as revoked (backward-compat: keeps FK refs from older versions intact)
  await db.update(mitreTechniques).set({ revoked: true }).where(notInArray(mitreTechniques.id, allTechIds));
});
