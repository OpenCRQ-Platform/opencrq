import {
  COVERAGE_BUCKETS,
  DRATA_ATTESTED_LEVELS,
  DRATA_EVIDENCE_REACHES,
  drataControls,
  drataFrameworks,
  drataRequirements,
  STRENGTH_RUNGS,
} from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { computeSupportingControls } from '../../drata-sync/derive-assessments';

const DrataFrameworkSchema = createSelectSchema(drataFrameworks).omit({
  nameFolded: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
});
const DrataRequirementSchema = createSelectSchema(drataRequirements).omit({
  tenantId: true,
  createdAt: true,
  updatedAt: true,
});
const DrataRequirementListItemSchema = createSelectSchema(drataRequirements)
  .pick({ id: true, code: true, name: true, category: true, isInScope: true, isReady: true })
  .extend({ controlCount: z.number() });
const DrataControlRowSchema = createSelectSchema(drataControls)
  .pick({ id: true, code: true, name: true, isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: true, archivedAt: true });
const DrataControlListItemSchema = DrataControlRowSchema.extend({ requirementCount: z.number() });

const DerivedValuesSchema = z.object({
  strengthRung: z.enum(STRENGTH_RUNGS),
  coverageBucket: z.enum(COVERAGE_BUCKETS),
});

const SupportingControlSchema = z.object({
  code: z.string(),
  name: z.string(),
  isReady: z.boolean(),
  levels: z.array(z.enum(DRATA_ATTESTED_LEVELS)),
  reach: z.enum(DRATA_EVIDENCE_REACHES).optional(),
});

export const drataRouter = (procedure: TenantProcedure) => router({
  // bounded-by: IMPORTED_FRAMEWORK_TAGS, the Drata frameworks the sync mirrors (ISO 27001, SOC 2)
  getFrameworks: procedure
    // XTM One's framework tool prints the slug, readiness, in-scope control count and description.
    .output(z.array(DrataFrameworkSchema.pick({
      id: true,
      drataId: true,
      tag: true,
      slug: true,
      name: true,
      description: true,
      isReady: true,
      numInScopeControls: true,
      numInScopeRequirements: true,
      numReadyInScopeRequirements: true,
      lastReportedAt: true,
    }).extend({
      derivedTotalRequirements: z.number(),
      derivedInScopeRequirements: z.number(),
      derivedReadyInScopeRequirements: z.number(),
    })))
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).drata.getFrameworks()),

  getFramework: procedure
    .input(z.object({ id: z.uuid() }))
    .output(DrataFrameworkSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).drata.getFramework(input.id) ?? null),

  // bounded-by: one framework's mirrored requirements, 123 (ISO 27001) and 61 (SOC 2) on a test tenant.
  // Unpaginated because the table filters in memory and useFrameworkReadiness counts every row.
  getRequirements: procedure
    .input(z.object({ frameworkId: z.uuid() }))
    .output(z.array(DrataRequirementListItemSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).drata.getRequirements(input.frameworkId)),

  getRequirement: procedure
    .input(z.object({ id: z.uuid() }))
    .output(DrataRequirementSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).drata.getRequirement(input.id) ?? null),

  // bounded-by: the controls one requirement maps to, never more than its framework's (12 for ISO 27001, 11 for SOC 2
  // on a test tenant).
  getControlsForRequirement: procedure
    .input(z.object({ requirementId: z.uuid() }))
    .output(z.array(DrataControlRowSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).drata.getControlsForRequirement(input.requirementId)),

  // bounded-by: the controls one framework's requirements map to, 12 (ISO 27001) and 11 (SOC 2) on a test tenant,
  // never more than the tenant's Drata controls.
  getControlsForFramework: procedure
    .input(z.object({ frameworkId: z.uuid() }))
    .output(z.array(DrataControlListItemSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).drata.getControlsForFramework(input.frameworkId)),

  // Drata's reading alone; the value the controls get pools it with the assessments (`getPooledAssessment`).
  getCapabilityDerivation: procedure
    .input(z.object({ capabilityId: z.uuid() }))
    .output(z.object({
      // Whether the tenant's mirror holds any Drata control at all, whatever this control maps to.
      hasMirror: z.boolean(),
      derived: DerivedValuesSchema.nullable(),
      supports: z.array(SupportingControlSchema),
    }))
    .query(async ({ input, ctx: { services, origin } }) => {
      const svc = services.withOrigin(origin);
      const [readiness, readings, externalId] = await Promise.all([
        svc.drata.getLiveControlReadiness(),
        svc.controlCapabilities.getDrataReadings(),
        svc.controlCapabilities.getControlCapabilityExternalId(input.capabilityId),
      ]);
      const reading = readings.find((candidate) => candidate.capabilityId === input.capabilityId);
      return {
        hasMirror: readiness.length > 0,
        derived: reading ? { strengthRung: reading.strengthRung, coverageBucket: reading.coverageBucket } : null,
        supports: externalId === undefined ? [] : computeSupportingControls(readiness, externalId),
      };
    }),
});
