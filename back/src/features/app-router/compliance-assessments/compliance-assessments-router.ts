import {
  COMPLIANCE_ASSESSMENT_STATUSES,
  ComplianceAnswerStaleWriteError,
  ComplianceAssessmentInvalidInputError,
  ComplianceAssessmentNotFoundError,
  ComplianceAssessmentNotPublishedError,
  ComplianceAssessmentPublishedError,
  complianceFrameworkNodes,
  complianceFrameworks,
  CONTROL_LINK_AXES,
  FRAMEWORK_NODE_KINDS,
  MATURITY_LEVELS,
} from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';
import { withBadRequestOn, withConflictOn, withNotFoundOn } from '../structured-error-conflict';

const StatusEnum = z.enum(COMPLIANCE_ASSESSMENT_STATUSES);
const LevelSchema = z.union(MATURITY_LEVELS.map((level) => z.literal(level)));

const PersonSchema = z.object({ id: z.uuid(), name: z.string().nullable(), email: z.string() });
const ServiceAccountActorSchema = z.object({ id: z.uuid(), name: z.string().nullable() });

// XTM One's framework tool prints the key and the version beside the title.
const FrameworkSchema = createSelectSchema(complianceFrameworks).pick({ id: true, key: true, title: true, version: true });
const FrameworkNodeSchema = createSelectSchema(complianceFrameworkNodes, { kind: z.enum(FRAMEWORK_NODE_KINDS) })
  .pick({ id: true, parentId: true, code: true, title: true, kind: true, isRequirement: true, position: true });

const MaturitySummarySchema = z.object({
  requirementCount: z.number().int(),
  answeredCount: z.number().int(),
  notApplicableCount: z.number().int(),
  meanLevel: z.number().nullable(),
  distribution: z.array(z.number().int()),
});

const AssessmentListRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: StatusEnum,
  frameworkId: z.uuid(),
  frameworkTitle: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  maturity: MaturitySummarySchema,
});

const AnswerSchema = z.object({
  id: z.uuid(),
  requirementId: z.uuid(),
  owner: PersonSchema.nullable(),
  dueDate: z.iso.date().nullable(),
  level: z.number().int().nullable(),
  notApplicable: z.boolean(),
  comment: z.string().nullable(),
  updatedAt: z.coerce.date(),
});

const ControlLinkSchema = z.object({
  requirementId: z.uuid(),
  capabilityId: z.uuid(),
  externalId: z.string(),
  name: z.string(),
  axis: z.enum(CONTROL_LINK_AXES),
});

const AssessmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: StatusEnum,
  frameworkId: z.uuid(),
  frameworkTitle: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  publishedAt: z.coerce.date().nullable(),
  createdBy: PersonSchema.nullable(),
  publishedBy: PersonSchema.nullable(),
  createdByServiceAccount: ServiceAccountActorSchema.nullable(),
  publishedByServiceAccount: ServiceAccountActorSchema.nullable(),
  nodes: z.array(FrameworkNodeSchema),
  controlLinks: z.array(ControlLinkSchema),
  answers: z.array(AnswerSchema),
});

const ControlEvidenceSchema = z.object({
  requirementId: z.uuid(),
  code: z.string(),
  title: z.string(),
  frameworkTitle: z.string(),
  assessmentId: z.uuid(),
  assessmentName: z.string(),
  level: z.number().int(),
});

const NameSchema =z.string().trim().min(1).max(200);

const writeErrors = <T>(fn: () => Promise<T>) =>
  withNotFoundOn(ComplianceAssessmentNotFoundError, () =>
    withConflictOn(ComplianceAssessmentPublishedError, () =>
      withConflictOn(ComplianceAssessmentNotPublishedError, () =>
        withConflictOn(ComplianceAnswerStaleWriteError, () =>
          withBadRequestOn(ComplianceAssessmentInvalidInputError, fn)))));

export const complianceAssessmentsRouter = (procedure: TenantProcedure) => router({
  // bounded-by: BUNDLED_CATALOGS, the frameworks shipped with the platform, one platform-wide copy
  getFrameworks: procedure
    .output(z.array(FrameworkSchema))
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).complianceAssessments.getFrameworks()),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the assessments users create
  getAssessments: procedure
    .output(z.array(AssessmentListRowSchema))
    .query(({ ctx: { services, origin } }) =>
      services.withOrigin(origin).complianceAssessments.getAssessments()),

  getAssessment: procedure
    .input(z.object({ id: z.uuid() }))
    .output(AssessmentSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) =>
      await services.withOrigin(origin).complianceAssessments.getAssessment(input.id) ?? null),

  // bounded-by: the bundled frameworks' requirements mapped to the control
  getControlEvidence: procedure
    .input(z.object({ capabilityId: z.uuid() }))
    .output(z.array(ControlEvidenceSchema))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).complianceAssessments.getControlEvidence(input.capabilityId)),

  createAssessment: procedure
    .input(z.object({ name: NameSchema, frameworkId: z.uuid() }))
    .output(z.uuid())
    .mutation(({ input, ctx: { services, origin } }) => writeErrors(() =>
      services.withOrigin(origin).complianceAssessments.createAssessment(input))),

  renameAssessment: procedure
    .input(z.object({ id: z.uuid(), name: NameSchema }))
    .mutation(({ input, ctx: { services, origin } }) => writeErrors(() =>
      services.withOrigin(origin).complianceAssessments.renameAssessment(input.id, input.name))),

  answerRequirement: procedure
    .input(z.object({
      assessmentId: z.uuid(),
      requirementId: z.uuid(),
      ownerId: z.uuid().nullable(),
      dueDate: z.iso.date().nullable(),
      level: LevelSchema.nullable(),
      notApplicable: z.boolean(),
      comment: z.string().max(10_000).nullable(),
      // The answer's `updatedAt` as the caller read it, `null` when it read none: a save from an
      // older read is refused with CONFLICT. Coerced, since it travels as the ISO string a query returned.
      updatedAt: z.coerce.date().nullable(),
    }))
    .mutation(({ input, ctx: { services, origin } }) => writeErrors(() =>
      services.withOrigin(origin).complianceAssessments.answerRequirement(input))),

  publishAssessment: procedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => writeErrors(() =>
      services.withOrigin(origin).complianceAssessments.publishAssessment(input.id))),

  reopenAssessment: procedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => writeErrors(() =>
      services.withOrigin(origin).complianceAssessments.reopenAssessment(input.id))),

  deleteAssessment: procedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ input, ctx: { services, origin } }) => writeErrors(() =>
      services.withOrigin(origin).complianceAssessments.deleteAssessment(input.id))),
});
