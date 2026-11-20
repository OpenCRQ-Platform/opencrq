import { sql } from 'drizzle-orm';
import { chunk, dedupeBy } from '../../../seed-batch';
import { registerSeed } from '../../../seed-registry';
// Evaluated first so the ATT&CK seed registers, and runs, before this one: every link row
// references a technique that seed writes.
import '../../mitre-attack/data/mitre-attack-seed';
import { cweTechniqueLinks, cweWeaknesses } from '../schema';
import { cweWeaknessId, shippedLinkRows } from './cwe-link-rows';
import { CWE_WEAKNESSES } from './cwe-weaknesses';

const weaknessUpdate = { name: sql`excluded.name`, description: sql`excluded.description` };
const linkUpdate = { justificationName: sql`excluded.justification_name` };

// The divergence predicates read schema columns, so they are built inside the seed rather than at
// module scope, where the schema can still be undefined depending on the import order.
registerSeed(async (db) => {
  const weaknessDiverged = sql`${cweWeaknesses.name} IS DISTINCT FROM excluded.name
    OR ${cweWeaknesses.description} IS DISTINCT FROM excluded.description`;
  const linkDiverged = sql`${cweTechniqueLinks.justificationName} IS DISTINCT FROM excluded.justification_name`;

  const weaknesses = CWE_WEAKNESSES.map((weakness) => ({ id: cweWeaknessId(weakness.externalId), ...weakness }));
  for (const rows of chunk(dedupeBy(weaknesses, (weakness) => weakness.id))) {
    await db.insert(cweWeaknesses).values(rows)
      .onConflictDoUpdate({ target: cweWeaknesses.id, set: weaknessUpdate, setWhere: weaknessDiverged });
  }
  for (const rows of chunk(dedupeBy(shippedLinkRows(), (row) => row.id))) {
    await db.insert(cweTechniqueLinks).values(rows)
      .onConflictDoUpdate({ target: cweTechniqueLinks.id, set: linkUpdate, setWhere: linkDiverged });
  }
});
