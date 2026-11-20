import { StructuredError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { MaturityLevel } from './constants';
import type { AnswerState } from './scores';
import type { AnswerCapabilityReading } from '../controls/capability/pooled-derivation';
import { defineService } from '../../registry';
import { originServiceAccountId, originUserId, requireTenantId } from '../../security';
import { latestPublishedAnswers } from './published-answers';
import { complianceAssessmentsRepository } from './repository';
import { summariseMaturity } from './scores';

export class ComplianceAssessmentNotFoundError extends StructuredError {
  override readonly name: string = 'ComplianceAssessmentNotFoundError';

  constructor() {
    super('This assessment does not exist', { data: {} });
  }
}

export class ComplianceAssessmentPublishedError extends StructuredError {
  override readonly name: string = 'ComplianceAssessmentPublishedError';

  override readonly reason: string = 'ASSESSMENT_PUBLISHED';

  constructor() {
    super('This assessment is published and can no longer change', { data: {} });
  }
}

export class ComplianceAssessmentNotPublishedError extends StructuredError {
  override readonly name: string = 'ComplianceAssessmentNotPublishedError';

  constructor() {
    super('This assessment is a draft and has nothing to reopen', { data: {} });
  }
}

/** Thrown when the stored answer is not the one the caller read: another write landed in between. */
export class ComplianceAnswerStaleWriteError extends StructuredError {
  override readonly name: string = 'ComplianceAnswerStaleWriteError';

  override readonly reason: string = 'STALE_WRITE';

  constructor() {
    super('This answer has changed since it was last read', { data: {} });
  }
}

export class ComplianceAssessmentInvalidInputError extends StructuredError {
  override readonly name: string = 'ComplianceAssessmentInvalidInputError';

  constructor(reason: string) {
    super(reason, { data: {} });
  }
}

export interface ComplianceAnswerInput {
  assessmentId: string,
  requirementId: string,
  ownerId: string | null,
  dueDate: string | null,
  level: MaturityLevel | null,
  notApplicable: boolean,
  comment: string | null,
  /** The `updatedAt` of the answer the caller read, `null` when it read none. */
  updatedAt: Date | null,
}

export interface ControlAnswerEvidence {
  requirementId: string,
  code: string,
  title: string,
  frameworkTitle: string,
  assessmentId: string,
  assessmentName: string,
  level: number,
}

const answerStates =<T extends AnswerState & { requirementId: string }>(answers: ReadonlyArray<T>) =>
  new Map(answers.map((answer) => [answer.requirementId, answer]));

export const complianceAssessmentsService = defineService('complianceAssessments', complianceAssessmentsRepository)
  .implement({
    getFrameworks: async ({ repo }) => await repo.findFrameworks(),

    getAssessments: async ({ repo }) => {
      const assessments = await repo.findAssessments();
      if (assessments.length === 0) {
        return [];
      }
      const [requirements, answers] = await Promise.all([
        repo.findRequirementIdsByFramework([...new Set(assessments.map((assessment) => assessment.frameworkId))]),
        repo.findAnswerStatesByAssessmentIds(assessments.map((assessment) => assessment.id)),
      ]);
      const requirementIdsByFramework = Map.groupBy(requirements, (requirement) => requirement.frameworkId);
      const answersByAssessment = Map.groupBy(answers, (answer) => answer.assessmentId);
      return assessments.map((assessment) => ({
        ...assessment,
        maturity: summariseMaturity(
          (requirementIdsByFramework.get(assessment.frameworkId) ?? []).map((requirement) => requirement.id),
          answerStates(answersByAssessment.get(assessment.id) ?? []),
        ),
      }));
    },

    getAssessment: async ({ repo }, id: string) => {
      const assessment = await repo.findAssessmentById(id);
      if (!assessment) {
        return undefined;
      }
      const userIds = [assessment.createdById, assessment.publishedById].filter((userId) => userId !== null);
      const serviceAccountIds = [assessment.createdByServiceAccountId, assessment.publishedByServiceAccountId]
        .filter((serviceAccountId) => serviceAccountId !== null);
      const [nodes, controlLinks, answers, people, serviceAccountNames] = await Promise.all([
        repo.findFrameworkNodes(assessment.frameworkId),
        repo.findControlLinks(assessment.frameworkId),
        repo.findAnswersByAssessmentId(id),
        userIds.length === 0 ? Promise.resolve([]) : repo.findUsersByIds(userIds),
        serviceAccountIds.length === 0 ? Promise.resolve([]) : repo.findServiceAccountNamesByIds(serviceAccountIds),
      ]);
      const person = (userId: string | null) => people.find((candidate) => candidate.id === userId) ?? null;
      const serviceAccount = (serviceAccountId: string | null) => serviceAccountId === null
        ? null
        : { id: serviceAccountId, name: serviceAccountNames.find((candidate) => candidate.id === serviceAccountId)?.name ?? null };
      return {
        ...assessment,
        createdBy: person(assessment.createdById),
        publishedBy: person(assessment.publishedById),
        createdByServiceAccount: serviceAccount(assessment.createdByServiceAccountId),
        publishedByServiceAccount: serviceAccount(assessment.publishedByServiceAccountId),
        nodes,
        controlLinks,
        answers,
      };
    },

    createAssessment: async ({ repo, eventOrigin }, { name, frameworkId }: { name: string, frameworkId: string }) => {
      const tenantId = requireTenantId(eventOrigin);
      if (!await repo.findFrameworkById(frameworkId)) {
        throw new ComplianceAssessmentInvalidInputError('This framework does not exist');
      }
      const id = uuidv7();
      await repo.insertAssessment({
        id,
        tenantId,
        frameworkId,
        name,
        createdById: originUserId(eventOrigin) ?? null,
        createdByServiceAccountId: originServiceAccountId(eventOrigin) ?? null,
      });
      return id;
    },

    renameAssessment: async ({ atomic }, id: string, name: string) => {
      await atomic(async ({ repo }) => {
        const assessment = await repo.lockAssessmentForUpdate(id);
        if (!assessment) {
          throw new ComplianceAssessmentNotFoundError();
        }
        if (assessment.status === 'published') {
          throw new ComplianceAssessmentPublishedError();
        }
        await repo.updateAssessment(id, { name });
      });
    },

    answerRequirement: async ({ atomic, eventOrigin }, input: ComplianceAnswerInput) => {
      const tenantId = requireTenantId(eventOrigin);
      if (input.notApplicable && input.level !== null) {
        throw new ComplianceAssessmentInvalidInputError('A requirement is either answered on a level or not applicable');
      }
      await atomic(async ({ repo }) => {
        const assessment = await repo.lockAssessmentForUpdate(input.assessmentId);
        if (!assessment) {
          throw new ComplianceAssessmentNotFoundError();
        }
        if (assessment.status === 'published') {
          throw new ComplianceAssessmentPublishedError();
        }
        if (!await repo.findRequirement(assessment.frameworkId, input.requirementId)) {
          throw new ComplianceAssessmentInvalidInputError('This requirement is not part of the assessment\'s framework');
        }
        if (input.ownerId !== null && (await repo.findUsersByIds([input.ownerId])).length === 0) {
          throw new ComplianceAssessmentInvalidInputError('The owner must be a user of the tenant');
        }
        // Every answer write takes the assessment lock above, so no write can land between this read and the upsert.
        const stored = await repo.findAnswerUpdatedAt(input.assessmentId, input.requirementId);
        if ((stored?.getTime() ?? null) !== (input.updatedAt?.getTime() ?? null)) {
          throw new ComplianceAnswerStaleWriteError();
        }
        const updatedById = originUserId(eventOrigin) ?? null;
        await repo.upsertAnswer({
          id: uuidv7(),
          tenantId,
          assessmentId: input.assessmentId,
          requirementId: input.requirementId,
          ownerId: input.ownerId,
          dueDate: input.dueDate,
          level: input.level,
          notApplicable: input.notApplicable,
          comment: input.comment,
          updatedById,
        });
        await repo.updateAssessment(input.assessmentId, {});
      });
    },

    publishAssessment: async ({ atomic, eventOrigin }, id: string) => {
      await atomic(async ({ repo }) => {
        const assessment = await repo.lockAssessmentForUpdate(id);
        if (!assessment) {
          throw new ComplianceAssessmentNotFoundError();
        }
        if (assessment.status === 'published') {
          throw new ComplianceAssessmentPublishedError();
        }
        await repo.updateAssessment(id, {
          status: 'published',
          publishedAt: new Date(),
          publishedById: originUserId(eventOrigin) ?? null,
          publishedByServiceAccountId: originServiceAccountId(eventOrigin) ?? null,
        });
      });
    },

    /** What the tenant's published assessments say of each control they reach, one reading per typed link. */
    getPublishedControlReadings: async ({ repo, eventOrigin }): Promise<Array<AnswerCapabilityReading>> => {
      requireTenantId(eventOrigin);
      const [answers, links] = await Promise.all([repo.findPublishedAnswerStates(), repo.findAllControlLinks()]);
      const feeding = latestPublishedAnswers(answers.flatMap(({ publishedAt, ...answer }) =>
        (publishedAt === null ? [] : [{ ...answer, publishedAt }])));
      return links.flatMap((link) => {
        const answer = feeding.get(link.requirementId);
        return answer === undefined ? [] : [{
          capabilityId: link.capabilityId,
          axis: link.axis,
          level: answer.level,
          source: link.frameworkKey,
          assessmentId: answer.assessmentId,
          assessmentName: answer.assessmentName,
        }];
      });
    },

    /**
     * The answers behind one control's value: per linked requirement, the published answer that
     * feeds it, under the rule the derivation applies. A requirement whose feeding answer is not
     * applicable, or that no published assessment answered, is left out.
     */
    getControlEvidence: async ({ repo, eventOrigin }, capabilityId: string): Promise<Array<ControlAnswerEvidence>> => {
      requireTenantId(eventOrigin);
      const requirements = await repo.findCapabilityRequirements(capabilityId);
      if (requirements.length === 0) {
        return [];
      }
      const answers = await repo.findPublishedAnswersForRequirements(requirements.map((requirement) => requirement.requirementId));
      const feeding = latestPublishedAnswers(answers.flatMap(({ publishedAt, ...answer }) =>
        (publishedAt === null ? [] : [{ ...answer, publishedAt }])));
      return requirements.flatMap((requirement) => {
        const answer = feeding.get(requirement.requirementId);
        return answer === undefined ? [] : [{
          ...requirement,
          assessmentId: answer.assessmentId,
          assessmentName: answer.assessmentName,
          level: answer.level,
        }];
      });
    },

    reopenAssessment: async ({ atomic }, id: string) => {
      await atomic(async ({ repo }) => {
        const assessment = await repo.lockAssessmentForUpdate(id);
        if (!assessment) {
          throw new ComplianceAssessmentNotFoundError();
        }
        if (assessment.status !== 'published') {
          throw new ComplianceAssessmentNotPublishedError();
        }
        await repo.updateAssessment(id, { status: 'draft', publishedAt: null, publishedById: null, publishedByServiceAccountId: null });
      });
    },

    /** Its answers go with it, through the foreign key's cascade. */
    deleteAssessment: async ({ atomic }, id: string) => {
      await atomic(async ({ repo }) => {
        const assessment = await repo.lockAssessmentForUpdate(id);
        if (!assessment) {
          throw new ComplianceAssessmentNotFoundError();
        }
        if (assessment.status === 'published') {
          throw new ComplianceAssessmentPublishedError();
        }
        await repo.deleteAssessment(id);
      });
    },
  });
