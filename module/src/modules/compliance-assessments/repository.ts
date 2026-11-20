import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { orderByFolded } from '../../db/fold-text';
import { complianceAssessmentAnswers, complianceAssessments } from './schema';

export type ComplianceAssessmentUpdate = Partial<Pick<typeof complianceAssessments.$inferInsert, 'name' | 'status' | 'publishedAt' | 'publishedById' | 'publishedByServiceAccountId'>>;

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
const now = () => sql`now()` as unknown as Date;

export const complianceAssessmentsRepository = defineRepository({
  findFrameworks: ({ db, views }) =>
    db.select().from(views.complianceFrameworks).orderBy(...orderByFolded(views.complianceFrameworks.titleFolded, views.complianceFrameworks.title, false)),

  findFrameworkById: ({ db, views }, id: string) =>
    db.select().from(views.complianceFrameworks)
      .where(eq(views.complianceFrameworks.id, id))
      .limit(1)
      .then((rows) => rows.at(0)),

  findFrameworkNodes: ({ db, views }, frameworkId: string) =>
    db.select().from(views.complianceFrameworkNodes)
      .where(eq(views.complianceFrameworkNodes.frameworkId, frameworkId))
      .orderBy(asc(views.complianceFrameworkNodes.position)),

  findControlLinks: ({ db, views }, frameworkId: string) =>
    db.select({
      requirementId: views.complianceRequirementControls.requirementId,
      axis: views.complianceRequirementControls.axis,
      capabilityId: views.controlCapabilities.id,
      externalId: views.controlCapabilities.externalId,
      name: views.controlCapabilities.name,
    })
      .from(views.complianceRequirementControls)
      .innerJoin(views.complianceFrameworkNodes, eq(views.complianceRequirementControls.requirementId, views.complianceFrameworkNodes.id))
      .innerJoin(views.controlCapabilities, eq(views.complianceRequirementControls.capabilityId, views.controlCapabilities.id))
      .where(eq(views.complianceFrameworkNodes.frameworkId, frameworkId))
      .orderBy(asc(views.controlCapabilities.externalId)),

  /** Every typed link of every bundled framework, with the key the framework is listed under as a source. */
  findAllControlLinks: ({ db, views }) =>
    db.select({
      requirementId: views.complianceRequirementControls.requirementId,
      capabilityId: views.complianceRequirementControls.capabilityId,
      axis: views.complianceRequirementControls.axis,
      frameworkKey: views.complianceFrameworks.key,
    })
      .from(views.complianceRequirementControls)
      .innerJoin(views.complianceFrameworkNodes, eq(views.complianceRequirementControls.requirementId, views.complianceFrameworkNodes.id))
      .innerJoin(views.complianceFrameworks, eq(views.complianceFrameworkNodes.frameworkId, views.complianceFrameworks.id)),

  findPublishedAnswerStates: ({ db, views }) =>
    db.select({
      assessmentId: views.complianceAssessments.id,
      assessmentName: views.complianceAssessments.name,
      publishedAt: views.complianceAssessments.publishedAt,
      requirementId: views.complianceAssessmentAnswers.requirementId,
      level: views.complianceAssessmentAnswers.level,
      notApplicable: views.complianceAssessmentAnswers.notApplicable,
    })
      .from(views.complianceAssessmentAnswers)
      .innerJoin(views.complianceAssessments, eq(views.complianceAssessmentAnswers.assessmentId, views.complianceAssessments.id))
      .where(and(
        eq(views.complianceAssessments.status, 'published'),
        isNotNull(views.complianceAssessments.publishedAt),
      )),

  /** The requirements linked to one control, every framework included, in catalogue order. */
  findCapabilityRequirements: ({ db, views }, capabilityId: string) =>
    db.select({
      requirementId: views.complianceFrameworkNodes.id,
      code: views.complianceFrameworkNodes.code,
      title: views.complianceFrameworkNodes.title,
      frameworkTitle: views.complianceFrameworks.title,
    })
      .from(views.complianceRequirementControls)
      .innerJoin(views.complianceFrameworkNodes, eq(views.complianceRequirementControls.requirementId, views.complianceFrameworkNodes.id))
      .innerJoin(views.complianceFrameworks, eq(views.complianceFrameworkNodes.frameworkId, views.complianceFrameworks.id))
      .where(eq(views.complianceRequirementControls.capabilityId, capabilityId))
      .orderBy(...orderByFolded(views.complianceFrameworks.titleFolded, views.complianceFrameworks.title, false), asc(views.complianceFrameworkNodes.position)),

  findPublishedAnswersForRequirements: ({ db, views }, requirementIds: Array<string>) =>
    db.select({
      assessmentId: views.complianceAssessments.id,
      assessmentName: views.complianceAssessments.name,
      publishedAt: views.complianceAssessments.publishedAt,
      requirementId: views.complianceAssessmentAnswers.requirementId,
      level: views.complianceAssessmentAnswers.level,
      notApplicable: views.complianceAssessmentAnswers.notApplicable,
    })
      .from(views.complianceAssessmentAnswers)
      .innerJoin(views.complianceAssessments, eq(views.complianceAssessmentAnswers.assessmentId, views.complianceAssessments.id))
      .where(and(
        inArray(views.complianceAssessmentAnswers.requirementId, requirementIds),
        eq(views.complianceAssessments.status, 'published'),
        isNotNull(views.complianceAssessments.publishedAt),
      )),

  findRequirementIdsByFramework:({ db, views }, frameworkIds: Array<string>) =>
    db.select({ id: views.complianceFrameworkNodes.id, frameworkId: views.complianceFrameworkNodes.frameworkId })
      .from(views.complianceFrameworkNodes)
      .where(and(
        inArray(views.complianceFrameworkNodes.frameworkId, frameworkIds),
        eq(views.complianceFrameworkNodes.isRequirement, true),
      )),

  findRequirement: ({ db, views }, frameworkId: string, requirementId: string) =>
    db.select({ id: views.complianceFrameworkNodes.id })
      .from(views.complianceFrameworkNodes)
      .where(and(
        eq(views.complianceFrameworkNodes.id, requirementId),
        eq(views.complianceFrameworkNodes.frameworkId, frameworkId),
        eq(views.complianceFrameworkNodes.isRequirement, true),
      ))
      .limit(1)
      .then((rows) => rows.at(0)),

  findAssessments: ({ db, views }) =>
    db.select({
      id: views.complianceAssessments.id,
      name: views.complianceAssessments.name,
      status: views.complianceAssessments.status,
      frameworkId: views.complianceAssessments.frameworkId,
      frameworkTitle: views.complianceFrameworks.title,
      createdAt: views.complianceAssessments.createdAt,
      updatedAt: views.complianceAssessments.updatedAt,
    })
      .from(views.complianceAssessments)
      .innerJoin(views.complianceFrameworks, eq(views.complianceAssessments.frameworkId, views.complianceFrameworks.id))
      .orderBy(desc(views.complianceAssessments.createdAt)),

  findAssessmentById: ({ db, views }, id: string) =>
    db.select({
      id: views.complianceAssessments.id,
      name: views.complianceAssessments.name,
      status: views.complianceAssessments.status,
      frameworkId: views.complianceAssessments.frameworkId,
      frameworkTitle: views.complianceFrameworks.title,
      createdById: views.complianceAssessments.createdById,
      createdByServiceAccountId: views.complianceAssessments.createdByServiceAccountId,
      createdAt: views.complianceAssessments.createdAt,
      updatedAt: views.complianceAssessments.updatedAt,
      publishedById: views.complianceAssessments.publishedById,
      publishedByServiceAccountId: views.complianceAssessments.publishedByServiceAccountId,
      publishedAt: views.complianceAssessments.publishedAt,
    })
      .from(views.complianceAssessments)
      .innerJoin(views.complianceFrameworks, eq(views.complianceAssessments.frameworkId, views.complianceFrameworks.id))
      .where(eq(views.complianceAssessments.id, id))
      .limit(1)
      .then((rows) => rows.at(0)),

  findUsersByIds: ({ db, views }, ids: Array<string>) =>
    db.select({ id: views.users.id, name: views.users.name, email: views.users.email })
      .from(views.users)
      .where(inArray(views.users.id, ids)),

  findServiceAccountNamesByIds: ({ db, views }, ids: Array<string>) =>
    db.select({ id: views.serviceAccounts.id, name: views.serviceAccounts.name })
      .from(views.serviceAccounts)
      .where(inArray(views.serviceAccounts.id, ids)),

  findAnswerStatesByAssessmentIds: ({ db, views }, assessmentIds: Array<string>) =>
    db.select({
      assessmentId: views.complianceAssessmentAnswers.assessmentId,
      requirementId: views.complianceAssessmentAnswers.requirementId,
      level: views.complianceAssessmentAnswers.level,
      notApplicable: views.complianceAssessmentAnswers.notApplicable,
    })
      .from(views.complianceAssessmentAnswers)
      .where(inArray(views.complianceAssessmentAnswers.assessmentId, assessmentIds)),

  findAnswersByAssessmentId: ({ db, views }, assessmentId: string) =>
    db.select({
      id: views.complianceAssessmentAnswers.id,
      assessmentId: views.complianceAssessmentAnswers.assessmentId,
      requirementId: views.complianceAssessmentAnswers.requirementId,
      dueDate: views.complianceAssessmentAnswers.dueDate,
      level: views.complianceAssessmentAnswers.level,
      notApplicable: views.complianceAssessmentAnswers.notApplicable,
      comment: views.complianceAssessmentAnswers.comment,
      updatedAt: views.complianceAssessmentAnswers.updatedAt,
      owner: { id: views.users.id, name: views.users.name, email: views.users.email },
    })
      .from(views.complianceAssessmentAnswers)
      .leftJoin(views.users, eq(views.complianceAssessmentAnswers.ownerId, views.users.id))
      .where(eq(views.complianceAssessmentAnswers.assessmentId, assessmentId)),

  /**
   * Locks the assessment for the rest of the transaction, so a publication and an answer written
   * at the same moment cannot both see a draft. Holds only inside `atomic`.
   */
  lockAssessmentForUpdate: ({ db, views }, id: string) =>
    db.select({ id: views.complianceAssessments.id, status: views.complianceAssessments.status, frameworkId: views.complianceAssessments.frameworkId })
      .from(views.complianceAssessments)
      .where(eq(views.complianceAssessments.id, id))
      .for('update')
      .then((rows) => rows.at(0)),

  insertAssessment: ({ db }, values: typeof complianceAssessments.$inferInsert) =>
    db.insert(complianceAssessments).values([values]),

  updateAssessment: ({ db }, id: string, values: ComplianceAssessmentUpdate) =>
    db.update(complianceAssessments).set({ ...values, updatedAt: now() }).where(eq(complianceAssessments.id, id)),

  deleteAssessment: ({ db }, id: string) =>
    db.delete(complianceAssessments).where(eq(complianceAssessments.id, id)),

  findAnswerUpdatedAt: ({ db, views }, assessmentId: string, requirementId: string) =>
    db.select({ updatedAt: views.complianceAssessmentAnswers.updatedAt })
      .from(views.complianceAssessmentAnswers)
      .where(and(
        eq(views.complianceAssessmentAnswers.assessmentId, assessmentId),
        eq(views.complianceAssessmentAnswers.requirementId, requirementId),
      ))
      .then((rows) => rows.at(0)?.updatedAt),

  upsertAnswer: ({ db }, values: typeof complianceAssessmentAnswers.$inferInsert) =>
    db.insert(complianceAssessmentAnswers).values([values]).onConflictDoUpdate({
      target: [complianceAssessmentAnswers.assessmentId, complianceAssessmentAnswers.requirementId],
      set: {
        ownerId: values.ownerId ?? null,
        dueDate: values.dueDate ?? null,
        level: values.level ?? null,
        notApplicable: values.notApplicable ?? false,
        comment: values.comment ?? null,
        updatedById: values.updatedById ?? null,
        updatedAt: now(),
      },
    }),
});
