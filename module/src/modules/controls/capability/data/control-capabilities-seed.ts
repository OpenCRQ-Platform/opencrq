import { and, eq, notExists, sql } from 'drizzle-orm';
import type { SeedFunction } from '../../../../seed-registry';
import { notInUuids } from '../../../../db/uuid-array';
import { chunk, dedupeBy } from '../../../../seed-batch';
import { registerSeed } from '../../../../seed-registry';
import {
  controlCapabilities,
  controlCapabilityCrosswalk,
  controlCapabilityEdges,
  controlCapabilityStrengthRungLabels,
  controlCapabilityTechniqueOverrides,
} from '../schema';
import {
  controlCapabilitiesData,
  controlCapabilityCrosswalkData,
  controlCapabilityEdgesData,
  controlCapabilityStrengthRungLabelsData,
} from './capabilities.generated';

// `setWhere` only writes rows that actually diverged, avoiding a rewrite of every row on each boot.
const capabilityUpdate = {
  externalId: sql`excluded.external_id`,
  name: sql`excluded.name`,
  description: sql`excluded.description`,
  domain: sql`excluded.domain`,
  position: sql`excluded.position`,
};

const rungUpdate = { label: sql`excluded.label` };

const idUpdate = { id: sql`excluded.id` };

const edgeUpdate = {
  id: sql`excluded.id`,
  techniqueExternalId: sql`excluded.technique_external_id`,
};

// Platform reference seed for the defensive-capability catalogue. Idempotent
// upserts on deterministic ids, then a prune of what the catalogue no longer carries: a control taking
// another over keeps its row, and would otherwise keep its predecessor's edges and crosswalk. Its rung
// labels are rewritten, every control carrying all four, so only a control left out of the catalogue
// keeps labels for the prune to remove.
// Tenant assessments are NOT pre-seeded: an absent assessment is the L0/L0 baseline, created on first edit.
// The divergence predicates read schema columns, so they are built here rather than at module
// scope: `../schema` reaches this file back through the security policies, and a table read at
// import time would then be undefined depending on which module the process loaded first.
export const seedControlCapabilities: SeedFunction = async (db) => {
  const capabilityDiverged = sql`${controlCapabilities.externalId} IS DISTINCT FROM excluded.external_id
    OR ${controlCapabilities.name} IS DISTINCT FROM excluded.name
    OR ${controlCapabilities.description} IS DISTINCT FROM excluded.description
    OR ${controlCapabilities.domain} IS DISTINCT FROM excluded.domain
    OR ${controlCapabilities.position} IS DISTINCT FROM excluded.position`;
  const rungDiverged = sql`${controlCapabilityStrengthRungLabels.label} IS DISTINCT FROM excluded.label`;
  const edgeDiverged = sql`${controlCapabilityEdges.id} IS DISTINCT FROM excluded.id
    OR ${controlCapabilityEdges.techniqueExternalId} IS DISTINCT FROM excluded.technique_external_id`;
  const crosswalkDiverged = sql`${controlCapabilityCrosswalk.id} IS DISTINCT FROM excluded.id`;

  for (const rows of chunk(dedupeBy(controlCapabilitiesData, (cap) => cap.id))) {
    await db
      .insert(controlCapabilities)
      .values(rows)
      .onConflictDoUpdate({ target: controlCapabilities.id, set: capabilityUpdate, setWhere: capabilityDiverged });
  }

  const rungs = dedupeBy(controlCapabilityStrengthRungLabelsData, (rung) => `${rung.capabilityId}|${rung.rung}`);
  for (const rows of chunk(rungs)) {
    await db.insert(controlCapabilityStrengthRungLabels).values(rows).onConflictDoUpdate({
      target: [controlCapabilityStrengthRungLabels.capabilityId, controlCapabilityStrengthRungLabels.rung],
      set: rungUpdate,
      setWhere: rungDiverged,
    });
  }

  const edges = dedupeBy(
    controlCapabilityEdgesData,
    (edge) => `${edge.capabilityId}|${edge.mitreTechniqueId}|${edge.function}`,
  );
  for (const rows of chunk(edges)) {
    await db.insert(controlCapabilityEdges).values(rows).onConflictDoUpdate({
      target: [controlCapabilityEdges.capabilityId, controlCapabilityEdges.mitreTechniqueId, controlCapabilityEdges.function],
      set: edgeUpdate,
      setWhere: edgeDiverged,
    });
  }

  // On the natural key: a taken-over control's row for the same reference carries its predecessor's id.
  const crosswalk = dedupeBy(controlCapabilityCrosswalkData, (cross) => `${cross.capabilityId}|${cross.framework}|${cross.externalId}`);
  for (const rows of chunk(crosswalk)) {
    await db.insert(controlCapabilityCrosswalk).values(rows).onConflictDoUpdate({
      target: [controlCapabilityCrosswalk.capabilityId, controlCapabilityCrosswalk.framework, controlCapabilityCrosswalk.externalId],
      set: idUpdate,
      setWhere: crosswalkDiverged,
    });
  }

  // Every kept row now carries the catalogue's id, so whatever else remains is no longer in it.
  await db.delete(controlCapabilityEdges).where(notInUuids(controlCapabilityEdges.id, edges.map((edge) => edge.id)));
  await db.delete(controlCapabilityCrosswalk).where(notInUuids(controlCapabilityCrosswalk.id, crosswalk.map((cross) => cross.id)));
  const rungKeys = rungs.map((rung) => sql`(${rung.capabilityId}::uuid, ${rung.rung})`);
  await db.delete(controlCapabilityStrengthRungLabels).where(rungKeys.length === 0
    ? sql`true`
    : sql`(${controlCapabilityStrengthRungLabels.capabilityId}, ${controlCapabilityStrengthRungLabels.rung}) NOT IN (${sql.join(rungKeys, sql`, `)})`);

  // A removal of a technique the catalogue no longer links removes nothing; an added one still adds it.
  await db.delete(controlCapabilityTechniqueOverrides).where(and(
    eq(controlCapabilityTechniqueOverrides.kind, 'removed'),
    notExists(db.select({ id: controlCapabilityEdges.id }).from(controlCapabilityEdges).where(and(
      eq(controlCapabilityEdges.capabilityId, controlCapabilityTechniqueOverrides.capabilityId),
      eq(controlCapabilityEdges.mitreTechniqueId, controlCapabilityTechniqueOverrides.mitreTechniqueId),
      eq(controlCapabilityEdges.function, controlCapabilityTechniqueOverrides.function),
    ))),
  ));
};

registerSeed(seedControlCapabilities);
