import type { EventOrigin, MaturityLevel } from '@app/module';
import { BUNDLED_CATALOGS, BUNDLED_CONTROL_LINKS } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const [nistCsf] = BUNDLED_CATALOGS;
const frameworkId = nistCsf.framework.id;
const blankAnswer = { ownerId: null, dueDate: null, level: null, notApplicable: false, comment: null, updatedAt: null };

type Answer = MaturityLevel | 'na' | 'blank';

describe('The assessment evidence behind a control', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let iamId: string;
  let iamRequirements: Array<string>;

  const admin = () => services.withOrigin(adminOrigin);

  const answerAll = async (name: string, levels: ReadonlyArray<Answer>) => {
    const id = await admin().complianceAssessments.createAssessment({ name, frameworkId });
    for (const [index, level] of levels.entries()) {
      await admin().complianceAssessments.answerRequirement({
        ...blankAnswer,
        assessmentId: id,
        requirementId: iamRequirements[index],
        level: typeof level === 'number' ? level : null,
        notApplicable: level === 'na',
      });
    }
    return id;
  };

  const publish = async (name: string, levels: ReadonlyArray<Answer>) => {
    const id = await answerAll(name, levels);
    await admin().complianceAssessments.publishAssessment(id);
    return id;
  };

  const evidence = () => admin().complianceAssessments.getControlEvidence(iamId);

  const byRequirement = async () => new Map((await evidence()).map((row) => [row.requirementId, row]));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    const capabilities = await admin().controlCapabilities.getControlCapabilities();
    iamId = capabilities.find((capability) => capability.externalId === 'IDP')!.id;
    const nodePosition = new Map(nistCsf.nodes.map((node) => [node.id, node.position]));
    iamRequirements = (BUNDLED_CONTROL_LINKS.get(frameworkId) ?? [])
      .filter((link) => link.capabilityId === iamId)
      .map((link) => link.requirementId)
      .sort((a, b) => (nodePosition.get(a) ?? 0) - (nodePosition.get(b) ?? 0));
  });

  it('should list each linked requirement with its framework, code, title, assessment and level, in catalogue order', async () => {
    const t2 = await publish('T2 2026', [3, 3, 1, 3, 2, 4]);

    const rows = await evidence();

    expect(rows.map((row) => row.requirementId)).toEqual(iamRequirements);
    const firstNode = nistCsf.nodes.find((node) => node.id === iamRequirements[0])!;
    expect(rows[0]).toEqual({
      requirementId: iamRequirements[0],
      code: firstNode.code,
      title: firstNode.title,
      frameworkTitle: nistCsf.framework.title,
      assessmentId: t2,
      assessmentName: 'T2 2026',
      level: 3,
    });
    expect(rows.map((row) => row.level)).toEqual([3, 3, 1, 3, 2, 4]);
  });

  it('should keep the earlier published answer of a requirement a later publication left unanswered', async () => {
    const t2 = await publish('T2 2026', [3, 3, 1, 3]);
    const t3 = await publish('T3 2026', ['blank', 4, 'blank', 'blank']);

    const rows = await byRequirement();

    expect(rows.get(iamRequirements[0])).toMatchObject({ assessmentId: t2, assessmentName: 'T2 2026', level: 3 });
    expect(rows.get(iamRequirements[1])).toMatchObject({ assessmentId: t3, assessmentName: 'T3 2026', level: 4 });
  });

  it('should never show a draft answer', async () => {
    await publish('T2 2026', [3, 3, 1, 3]);
    await answerAll('T4 2026', [5, 5, 5, 5]);

    const rows = await evidence();

    expect(rows.map((row) => row.assessmentName)).toEqual(['T2 2026', 'T2 2026', 'T2 2026', 'T2 2026']);
    expect(rows.map((row) => row.level)).toEqual([3, 3, 1, 3]);
  });

  it('should stop showing an assessment once it is reopened', async () => {
    await publish('T2 2026', [3, 3, 1, 3]);
    const t3 = await publish('T3 2026', [4, 'blank', 'blank', 'blank']);
    await admin().complianceAssessments.reopenAssessment(t3);

    const rows = await byRequirement();

    expect(rows.get(iamRequirements[0])).toMatchObject({ assessmentName: 'T2 2026', level: 3 });
  });

  it('should leave out a requirement whose feeding answer is not applicable', async () => {
    await publish('T2 2026', [3, 3, 1, 3]);
    await publish('T3 2026', ['na', 'blank', 'blank', 'blank']);

    const rows = await byRequirement();

    expect(rows.has(iamRequirements[0])).toBe(false);
    expect(rows.size).toBe(3);
  });

  it('should list nothing before any assessment is published', async () => {
    await answerAll('T2 2026', [3, 3, 1, 3]);

    expect(await evidence()).toEqual([]);
  });

  it('should never show another tenant\'s answers', async () => {
    await publish('T2 2026', [3, 3, 1, 3]);
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    expect(await services.withOrigin(otherOrigin).complianceAssessments.getControlEvidence(iamId)).toEqual([]);
  });
});
