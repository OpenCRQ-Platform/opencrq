import type { EventOrigin } from '@app/module';
import {
  BUNDLED_CATALOGS,
  ComplianceAnswerStaleWriteError,
  complianceAssessmentAnswers,
  ComplianceAssessmentInvalidInputError,
  ComplianceAssessmentNotFoundError,
  ComplianceAssessmentNotPublishedError,
  ComplianceAssessmentPublishedError,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin, createUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const blankAnswer = { ownerId: null, dueDate: null, level: null, notApplicable: false, comment: null, updatedAt: null };

const [nistCsf] = BUNDLED_CATALOGS;
const frameworkId = nistCsf.framework.id;
const requirementIds = new Map(nistCsf.nodes.filter((node) => node.isRequirement).map((node) => [node.code, node.id]));

describe('Compliance assessments service', () => {
  let origin: EventOrigin;
  let tenantId: string;
  let userId: string;

  const assessments = () => services.withOrigin(origin).complianceAssessments;

  const createAssessment = async (name = 'NIST CSF 2.0 · T4 2026') =>
    assessments().createAssessment({ name, frameworkId });

  const requirement = (code: string) => {
    const id = requirementIds.get(code);
    if (!id) {
      throw new Error(`no requirement ${code}`);
    }
    return id;
  };

  const storedAt = async (assessmentId: string, requirementId: string) =>
    (await assessments().getAssessment(assessmentId))?.answers.find((answer) => answer.requirementId === requirementId)?.updatedAt ?? null;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    origin = setup.origin;
    tenantId = setup.tenantId;
    userId = setup.userId;
  });

  describe('catalogue', () => {
    it('should offer NIST CSF 2.0 with its 6 functions, 22 categories and 106 subcategories', async () => {
      const frameworks = await assessments().getFrameworks();
      expect(frameworks.map((framework) => framework.title)).toEqual(['NIST CSF 2.0']);

      const assessment = await assessments().getAssessment(await createAssessment());
      const count = (kind: string) => assessment?.nodes.filter((node) => node.kind === kind).length;
      expect(count('function')).toBe(6);
      expect(count('category')).toBe(22);
      expect(count('subcategory')).toBe(106);
      expect(assessment?.nodes.find((node) => node.code === 'PR.AA-03')?.title).toBe('Users, services, and hardware are authenticated');
    });

    it('should link 35 requirements to 51 controls, each link typed by its axis', async () => {
      const assessment = await assessments().getAssessment(await createAssessment());
      const links = assessment?.controlLinks ?? [];
      const fedBy = (code: string) => links.filter((link) => link.requirementId === requirement(code)).map((link) => link.externalId);

      expect(links).toHaveLength(169);
      expect(new Set(links.map((link) => link.requirementId)).size).toBe(35);
      expect(new Set(links.map((link) => link.capabilityId)).size).toBe(51);
      expect(links.every((link) => link.axis === 'capability')).toBe(true);
      expect(fedBy('PR.AA-03')).toEqual(['AIGW', 'APPH', 'CLDH', 'IDP', 'ITDR', 'NAC', 'SAASH', 'WAF', 'WIFI', 'ZTNA']);
      expect(fedBy('GV.OC-01')).toEqual([]);
    });
  });

  describe('creation', () => {
    it('should create a draft with nothing answered', async () => {
      const id = await createAssessment();

      const [row] = await assessments().getAssessments();
      expect(row).toMatchObject({ id, name: 'NIST CSF 2.0 · T4 2026', status: 'draft', frameworkTitle: 'NIST CSF 2.0' });
      expect(row.maturity).toMatchObject({ requirementCount: 106, answeredCount: 0, notApplicableCount: 0, meanLevel: null });

      const assessment = await assessments().getAssessment(id);
      expect(assessment?.createdBy?.id).toBe(userId);
      expect(assessment?.publishedAt).toBeNull();
    });

    it('should let several assessments of the same framework coexist', async () => {
      await createAssessment('T2 2026');
      await createAssessment('T4 2026');

      expect((await assessments().getAssessments()).map((row) => row.name).sort()).toEqual(['T2 2026', 'T4 2026']);
    });
  });

  describe('answers', () => {
    it('should score the answered requirements only, leaving out the unanswered and the not applicable', async () => {
      const id = await createAssessment();
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('PR.AA-01'), level: 3 });
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('PR.AA-02'), level: 2 });
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('PR.AA-05'), level: 1 });
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('PR.AA-06'), notApplicable: true });
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('PR.AA-04'), ownerId: userId, dueDate: '2026-11-30' });

      const [row] = await assessments().getAssessments();
      expect(row.maturity).toMatchObject({ answeredCount: 3, notApplicableCount: 1, meanLevel: 2 });
      expect(row.maturity.distribution).toEqual([0, 1, 1, 1, 0, 0]);
    });

    it('should replace the previous answer of a requirement', async () => {
      const id = await createAssessment();
      const requirementId = requirement('GV.OC-01');
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 1, comment: 'first' });
      await assessments().answerRequirement({
        ...blankAnswer, assessmentId: id, requirementId, level: 4, ownerId: userId, dueDate: '2026-12-15', comment: 'second', updatedAt: await storedAt(id, requirementId),
      });

      const answers = (await assessments().getAssessment(id))?.answers ?? [];
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ level: 4, dueDate: '2026-12-15', comment: 'second', owner: { id: userId } });
    });

    it('should refuse an answer both on a level and not applicable', async () => {
      const id = await createAssessment();

      await expect(assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 2, notApplicable: true }))
        .rejects.toBeInstanceOf(ComplianceAssessmentInvalidInputError);
    });

    it('should refuse an answer on a category, which is no requirement', async () => {
      const id = await createAssessment();
      const category = (await assessments().getAssessment(id))?.nodes.find((node) => node.code === 'GV.OC');

      await expect(assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: category?.id ?? '' }))
        .rejects.toBeInstanceOf(ComplianceAssessmentInvalidInputError);
    });

    it('should refuse an owner who is not a user of the tenant, and accept one who is', async () => {
      const id = await createAssessment();
      const outsider = await createUser(db);
      const member = await createTenantUser(services, db, origin);

      await expect(assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), ownerId: outsider.userId }))
        .rejects.toBeInstanceOf(ComplianceAssessmentInvalidInputError);
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), ownerId: member.userId });

      expect((await assessments().getAssessment(id))?.answers[0].owner?.id).toBe(member.userId);
    });
  });

  describe('concurrent edits', () => {
    it('should take a first answer from a caller that read none', async () => {
      const id = await createAssessment();

      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 2, updatedAt: null });

      expect((await assessments().getAssessment(id))?.answers.map((answer) => answer.level)).toEqual([2]);
    });

    it('should accept a save made from the stored answer', async () => {
      const id = await createAssessment();
      const requirementId = requirement('GV.OC-01');
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 2 });

      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 3, updatedAt: await storedAt(id, requirementId) });

      expect((await assessments().getAssessment(id))?.answers.map((answer) => answer.level)).toEqual([3]);
    });

    it('should refuse the second of two saves made from the same answer', async () => {
      const id = await createAssessment();
      const requirementId = requirement('GV.OC-01');
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 2 });
      const updatedAt = await storedAt(id, requirementId);

      const results = await Promise.allSettled([
        assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 3, updatedAt }),
        assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 4, updatedAt }),
      ]);

      const refused = results.filter((result) => result.status === 'rejected');
      expect(refused).toHaveLength(1);
      expect(refused[0].reason).toBeInstanceOf(ComplianceAnswerStaleWriteError);
      const winner = results[0].status === 'fulfilled' ? 3 : 4;
      expect((await assessments().getAssessment(id))?.answers.map((answer) => answer.level)).toEqual([winner]);
    });

    it('should refuse the second of two first answers', async () => {
      const id = await createAssessment();
      const requirementId = requirement('GV.OC-01');

      const results = await Promise.allSettled([
        assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 1, updatedAt: null }),
        assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId, level: 5, updatedAt: null }),
      ]);

      const refused = results.filter((result) => result.status === 'rejected');
      expect(refused).toHaveLength(1);
      expect(refused[0].reason).toBeInstanceOf(ComplianceAnswerStaleWriteError);
    });
  });

  describe('publication', () => {
    it('should stamp who published and when', async () => {
      const id = await createAssessment();

      await assessments().publishAssessment(id);

      const assessment = await assessments().getAssessment(id);
      expect(assessment?.status).toBe('published');
      expect(assessment?.publishedBy?.id).toBe(userId);
      expect(assessment?.publishedAt).toBeInstanceOf(Date);
    });

    it('should refuse every write to a published assessment', async () => {
      const id = await createAssessment();
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 2 });
      await assessments().publishAssessment(id);

      await expect(assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 5 }))
        .rejects.toBeInstanceOf(ComplianceAssessmentPublishedError);
      await expect(assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-02'), ownerId: userId, dueDate: '2026-12-01' }))
        .rejects.toBeInstanceOf(ComplianceAssessmentPublishedError);
      await expect(assessments().renameAssessment(id, 'Renamed')).rejects.toBeInstanceOf(ComplianceAssessmentPublishedError);
      await expect(assessments().publishAssessment(id)).rejects.toBeInstanceOf(ComplianceAssessmentPublishedError);

      const assessment = await assessments().getAssessment(id);
      expect(assessment?.name).toBe('NIST CSF 2.0 · T4 2026');
      expect(assessment?.answers.map((answer) => answer.level)).toEqual([2]);
    });

    it('should reopen a published assessment as an editable draft that keeps its answers', async () => {
      const id = await createAssessment();
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 2 });
      await assessments().publishAssessment(id);

      await assessments().reopenAssessment(id);

      const reopened = await assessments().getAssessment(id);
      expect(reopened).toMatchObject({ status: 'draft', publishedAt: null, publishedBy: null });
      expect(reopened?.answers.map((answer) => answer.level)).toEqual([2]);
      await assessments().answerRequirement({
        ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 4, updatedAt: await storedAt(id, requirement('GV.OC-01')),
      });
      expect((await assessments().getAssessment(id))?.answers.map((answer) => answer.level)).toEqual([4]);
    });

    it('should refuse to reopen a draft', async () => {
      const id = await createAssessment();

      await expect(assessments().reopenAssessment(id)).rejects.toBeInstanceOf(ComplianceAssessmentNotPublishedError);
    });

    it('should rename a draft', async () => {
      const id = await createAssessment();

      await assessments().renameAssessment(id, 'NIST CSF 2.0 · T1 2027');

      expect((await assessments().getAssessment(id))?.name).toBe('NIST CSF 2.0 · T1 2027');
    });
  });

  describe('deletion', () => {
    const storedAnswerCount = async (assessmentId: string) =>
      db.$count(complianceAssessmentAnswers, eq(complianceAssessmentAnswers.assessmentId, assessmentId));

    it('should delete a draft with its answers and leave the other assessments alone', async () => {
      const id = await createAssessment('Deleted');
      const keptId = await createAssessment('Kept');
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 2 });
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: keptId, requirementId: requirement('GV.OC-01'), level: 3 });

      await assessments().deleteAssessment(id);

      expect(await assessments().getAssessment(id)).toBeUndefined();
      expect(await storedAnswerCount(id)).toBe(0);
      expect((await assessments().getAssessments()).map((row) => row.name)).toEqual(['Kept']);
      expect((await assessments().getAssessment(keptId))?.answers.map((answer) => answer.level)).toEqual([3]);
    });

    it('should refuse to delete a published assessment, and delete it once reopened', async () => {
      const id = await createAssessment();
      await assessments().answerRequirement({ ...blankAnswer, assessmentId: id, requirementId: requirement('GV.OC-01'), level: 2 });
      await assessments().publishAssessment(id);

      await expect(assessments().deleteAssessment(id)).rejects.toBeInstanceOf(ComplianceAssessmentPublishedError);
      expect((await assessments().getAssessment(id))?.answers.map((answer) => answer.level)).toEqual([2]);

      await assessments().reopenAssessment(id);
      await assessments().deleteAssessment(id);
      expect(await assessments().getAssessment(id)).toBeUndefined();
    });

    it('should refuse to delete an assessment that does not exist', async () => {
      await expect(assessments().deleteAssessment(uuidv7())).rejects.toBeInstanceOf(ComplianceAssessmentNotFoundError);
    });
  });

  describe('attribution to a service account', () => {
    let serviceAccountId: string;
    let serviceOrigin: EventOrigin;

    const asService = () => services.withOrigin(serviceOrigin).complianceAssessments;

    beforeEach(async () => {
      serviceAccountId = uuidv7();
      await services.withOrigin(origin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Sync Bot' });
      serviceOrigin = { type: 'connector', serviceAccountId, tenantId };
    });

    it('should credit the service account that opened and published, and no user', async () => {
      const id = await asService().createAssessment({ name: 'Opened by a bot', frameworkId });
      await asService().publishAssessment(id);

      const assessment = await assessments().getAssessment(id);
      expect(assessment).toMatchObject({
        createdBy: null,
        publishedBy: null,
        createdByServiceAccount: { id: serviceAccountId, name: 'Sync Bot' },
        publishedByServiceAccount: { id: serviceAccountId, name: 'Sync Bot' },
      });
    });

    it('should hide the name from a member without MANAGE_SECURITY but keep the id', async () => {
      const id = await asService().createAssessment({ name: 'Opened by a bot', frameworkId });
      await asService().publishAssessment(id);
      const member = await createTenantUser(services, db, origin);

      const assessment = await services.withOrigin(member.origin).complianceAssessments.getAssessment(id);
      expect(assessment).toMatchObject({
        createdByServiceAccount: { id: serviceAccountId, name: null },
        publishedByServiceAccount: { id: serviceAccountId, name: null },
      });
    });

    it('should clear the publishing service account on reopening, and credit the user who publishes again', async () => {
      const id = await asService().createAssessment({ name: 'Opened by a bot', frameworkId });
      await asService().publishAssessment(id);

      await assessments().reopenAssessment(id);
      expect(await assessments().getAssessment(id)).toMatchObject({
        publishedBy: null,
        publishedByServiceAccount: null,
        createdByServiceAccount: { id: serviceAccountId, name: 'Sync Bot' },
      });

      await assessments().publishAssessment(id);
      const republished = await assessments().getAssessment(id);
      expect(republished?.publishedBy?.id).toBe(userId);
      expect(republished?.publishedByServiceAccount).toBeNull();
    });

    it('should leave both service account fields empty for an assessment a user opened', async () => {
      const id = await createAssessment();
      await assessments().publishAssessment(id);

      const assessment = await assessments().getAssessment(id);
      expect(assessment?.createdBy?.id).toBe(userId);
      expect(assessment?.createdByServiceAccount).toBeNull();
      expect(assessment?.publishedByServiceAccount).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    let otherOrigin: EventOrigin;
    let otherAssessmentId: string;

    beforeEach(async () => {
      const otherTenantId = await createTenant(services, userId);
      otherOrigin = { type: 'client', userId, tenantId: otherTenantId };
      otherAssessmentId = await services.withOrigin(otherOrigin).complianceAssessments.createAssessment({ name: 'Other tenant', frameworkId });
      await services.withOrigin(otherOrigin).complianceAssessments.answerRequirement({
        ...blankAnswer, assessmentId: otherAssessmentId, requirementId: requirement('GV.OC-01'), level: 3,
      });
    });

    it('should list only the caller tenant\'s assessments', async () => {
      await createAssessment('Mine');

      expect((await assessments().getAssessments()).map((row) => row.name)).toEqual(['Mine']);
    });

    it('should not read another tenant\'s assessment or its answers', async () => {
      expect(await assessments().getAssessment(otherAssessmentId)).toBeUndefined();
    });

    it('should refuse to answer, rename, publish, reopen or delete another tenant\'s assessment', async () => {
      await expect(assessments().answerRequirement({ ...blankAnswer, assessmentId: otherAssessmentId, requirementId: requirement('GV.OC-01'), level: 0 }))
        .rejects.toBeInstanceOf(ComplianceAssessmentNotFoundError);
      await expect(assessments().renameAssessment(otherAssessmentId, 'Taken')).rejects.toBeInstanceOf(ComplianceAssessmentNotFoundError);
      await expect(assessments().publishAssessment(otherAssessmentId)).rejects.toBeInstanceOf(ComplianceAssessmentNotFoundError);
      await expect(assessments().reopenAssessment(otherAssessmentId)).rejects.toBeInstanceOf(ComplianceAssessmentNotFoundError);
      await expect(assessments().deleteAssessment(otherAssessmentId)).rejects.toBeInstanceOf(ComplianceAssessmentNotFoundError);

      const untouched = await services.withOrigin(otherOrigin).complianceAssessments.getAssessment(otherAssessmentId);
      expect(untouched).toMatchObject({ name: 'Other tenant', status: 'draft' });
      expect(untouched?.answers.map((answer) => answer.level)).toEqual([3]);
    });
  });
});
