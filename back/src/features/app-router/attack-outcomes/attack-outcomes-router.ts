import { attackOutcomes, CRITERION_INHERITANCES, THREAT_ENTITY_TYPES } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const CriterionReachSchema = z.enum(CRITERION_INHERITANCES);
const AttackOutcomesSchema = createSelectSchema(attackOutcomes).omit({ nameFolded: true }).extend({
  reachesAvailability: CriterionReachSchema,
  reachesIntegrity: CriterionReachSchema,
  reachesConfidentiality: CriterionReachSchema,
  reachesTraceability: CriterionReachSchema,
});

const ThreatReferenceSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  entityType: z.enum(THREAT_ENTITY_TYPES),
  /** The threat's own share: the contributions sum to the technique's weight. */
  share: z.number().nonnegative().max(1),
});

const AttackOutcomeMitreTechniqueSchema = z.object({
  mitreTechniqueId: z.uuid(),
  category: z.enum(['signature', 'related', 'inferred']),
  externalId: z.string(),
  name: z.string(),
  revoked: z.boolean(),
  /** Share of the admitted attacker mixture whose repertoire contains this technique. */
  weight: z.number().nonnegative().max(1),
  /** Deduplicated threats contributing that share, highest first. */
  threats: z.array(ThreatReferenceSchema),
  /** Number of contributing threats. */
  sourceCount: z.number(),
  /**
   * The part of `weight` that blocking this technique denies rather than displaces: the summed
   * shares of the contributing threats whose ingested repertoire holds no other technique
   * sharing a tactic with it. Never above `weight`.
   */
  bindingShare: z.number().nonnegative().max(1),
});

const AttackOutcomeTechniquesSchema = z.object({
  evidenceMode: z.enum(['attacker-mixture', 'no-relevant-threats', 'mixture-pending', 'no-scenario']),
  techniques: z.array(AttackOutcomeMitreTechniqueSchema),
});

const RepertoireTechniqueSchema = AttackOutcomeMitreTechniqueSchema
  .pick({ mitreTechniqueId: true, externalId: true, name: true, revoked: true, weight: true, threats: true, sourceCount: true })
  .extend({ tacticNames: z.array(z.string()) });

const RepertoireTechniquesSchema = z.object({
  evidenceMode: z.enum(['attacker-mixture', 'no-relevant-threats', 'mixture-pending', 'no-scenario']),
  /** Every admitted threat, whether or not it plays a given technique. */
  actors: z.array(ThreatReferenceSchema),
  techniques: z.array(RepertoireTechniqueSchema),
  /** Techniques curated on the outcome that no admitted threat plays. */
  unplayedCuratedCount: z.number().nonnegative(),
});

// Only the two categories the curated junction can hold: `inferred` is a mixture-derived category,
// never a junction row.
const CuratedOutcomeTechniqueSchema = AttackOutcomeMitreTechniqueSchema
  .pick({ mitreTechniqueId: true, externalId: true, name: true, revoked: true })
  .extend({ category: z.enum(['signature', 'related']) });

export const attackOutcomesRouter = (procedure: TenantProcedure) => router({
  getAttackOutcome: procedure
    .input(z.object({ id: z.uuid() }))
    .output(AttackOutcomesSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .attackOutcomes.getAttackOutcome(input.id) ?? null),
  // bounded-by: the attack-outcome catalogue, 7 outcomes seeded into every tenant
  getAttackOutcomes: procedure
    .output(z.array(AttackOutcomesSchema.pick({ id: true, name: true, description: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .attackOutcomes.getAttackOutcomes()),
  // `organizationId` is part of the key, not an ambient concern: the weight is a share of the
  // attacker mixture admitted against THAT organization's country and sector.
  getMitreTechniquesForOutcome: procedure
    .input(z.object({ attackOutcomeId: z.uuid(), organizationId: z.uuid() }))
    .output(AttackOutcomeTechniquesSchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .attackOutcomes.getMitreTechniquesForOutcome(input.attackOutcomeId, { organizationId: input.organizationId })),
  getRepertoireTechniquesForOutcome: procedure
    .input(z.object({ attackOutcomeId: z.uuid(), organizationId: z.uuid() }))
    .output(RepertoireTechniquesSchema)
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .attackOutcomes.getRepertoireTechniquesForOutcome(input.attackOutcomeId, { organizationId: input.organizationId })),
  // No `organizationId`: the curated junction is not weighed against any targeting profile.
  // bounded-by: one outcome's curated techniques, seeded from ATTACK_OUTCOMES, 13 at most
  getCuratedMitreTechniquesForOutcome: procedure
    .input(z.object({ attackOutcomeId: z.uuid() }))
    .output(z.array(CuratedOutcomeTechniqueSchema))
    .query(({ input, ctx: { services, origin } }) => services.withOrigin(origin)
      .attackOutcomes.getCuratedMitreTechniquesForOutcome(input.attackOutcomeId)),
});
