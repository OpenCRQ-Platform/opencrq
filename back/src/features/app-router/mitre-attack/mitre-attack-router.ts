import { mitreMitigations, mitreTactics, mitreTechniques } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const TacticsSchema = createSelectSchema(mitreTactics);
const TechniquesSchema = createSelectSchema(mitreTechniques).omit({ nameFolded: true });
const MitigationsSchema = createSelectSchema(mitreMitigations);

const RelatedTacticSchema = z.object({ id: z.string(), externalId: z.string(), name: z.string() });
const RelatedTechniqueSchema = z.object({ id: z.string(), externalId: z.string(), name: z.string(), revoked: z.boolean() });
// Both grains answer a tactic and a mitigation, so their technique lists carry the grain.
const RelatedGrainedTechniqueSchema = RelatedTechniqueSchema.extend({ isSubtechnique: z.boolean() });
const RelatedMitigationSchema = z.object({ id: z.string(), externalId: z.string(), name: z.string() });

const TechniqueDetailSchema = TechniquesSchema.extend({
  replacedByTechniqueExternalId: z.string().nullable(),
  tactics: z.array(RelatedTacticSchema),
  subTechniques: z.array(RelatedTechniqueSchema),
  mitigations: z.array(RelatedMitigationSchema),
});

const TacticDetailSchema = TacticsSchema.extend({
  techniques: z.array(RelatedGrainedTechniqueSchema),
});

const MitigationDetailSchema = MitigationsSchema.extend({
  techniques: z.array(RelatedGrainedTechniqueSchema),
});

const TechniqueListItemSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  name: z.string(),
  isSubtechnique: z.boolean(),
});

const MatrixTechniqueSchema = TechniqueListItemSchema.extend({
  parentTechniqueId: z.string().nullable(),
});

const MatrixJunctionSchema = z.object({
  techniqueId: z.string(),
  tacticId: z.string(),
});

const MatrixSchema = z.object({
  tactics: z.array(TacticsSchema.pick({ id: true, externalId: true, name: true, order: true })),
  techniques: z.array(MatrixTechniqueSchema),
  junctions: z.array(MatrixJunctionSchema),
});

export const mitreAttackRouter = (procedure: TenantProcedure) => router({
  // bounded-by: the ATT&CK tactic catalogue, 15 rows, one platform-wide copy
  getTactics: procedure
    .output(z.array(TacticsSchema.pick({ id: true, externalId: true, name: true, description: true, order: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .mitreAttack.getTactics()),
  getTacticByExternalId: procedure
    .input(z.object({ externalId: z.string().min(1) }))
    .output(TacticDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .mitreAttack.getTacticByExternalId(input.externalId) ?? null),
  // bounded-by: the ATT&CK technique catalogue, ~700 rows, one platform-wide copy whatever the tenant
  getTechniques: procedure
    .output(z.array(TechniqueListItemSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .mitreAttack.getTechniques()),
  getTechniqueByExternalId: procedure
    .input(z.object({ externalId: z.string().min(1) }))
    .output(TechniqueDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .mitreAttack.getTechniqueByExternalId(input.externalId) ?? null),
  // bounded-by: the ATT&CK mitigation catalogue, 44 rows, one platform-wide copy
  getMitigations: procedure
    .output(z.array(MitigationsSchema.pick({ id: true, externalId: true, name: true, description: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .mitreAttack.getMitigations()),
  getMitigationByExternalId: procedure
    .input(z.object({ externalId: z.string().min(1) }))
    .output(MitigationDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .mitreAttack.getMitigationByExternalId(input.externalId) ?? null),
  getMatrix: procedure
    .output(MatrixSchema)
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .mitreAttack.getMatrix()),
});
