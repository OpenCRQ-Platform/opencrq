import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Compliance assessments (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
  });

  it('should create and list an assessment', async () => {
    const frameworks = await client.query('complianceAssessments.getFrameworks', undefined, { tenantId });
    const frameworkId: string = frameworks.json.result.data[0].id;

    await client.mutation('complianceAssessments.createAssessment', { name: 'NIST CSF 2.0 · T4 2026', frameworkId }, { tenantId });
    const list = await client.query('complianceAssessments.getAssessments', undefined, { tenantId });

    expect(list.status).toBe(200);
    expect(list.json.result.data).toMatchObject([{ name: 'NIST CSF 2.0 · T4 2026', status: 'draft', maturity: { requirementCount: 106, meanLevel: null } }]);
  });

  it('should answer a published assessment with a conflict', async () => {
    const frameworks = await client.query('complianceAssessments.getFrameworks', undefined, { tenantId });
    const created = await client.mutation('complianceAssessments.createAssessment', { name: 'T2', frameworkId: frameworks.json.result.data[0].id }, { tenantId });
    const id: string = created.json.result.data;
    await client.mutation('complianceAssessments.publishAssessment', { id }, { tenantId });

    const rename = await client.mutation('complianceAssessments.renameAssessment', { id, name: 'Renamed' }, { tenantId });

    expect(rename.status).toBe(409);
    expect(rename.json.error.data.reason).toBe('ASSESSMENT_PUBLISHED');
  });

  it('should answer the deletion of a published assessment with a conflict, and of an unknown one with not found', async () => {
    const frameworks = await client.query('complianceAssessments.getFrameworks', undefined, { tenantId });
    const created = await client.mutation('complianceAssessments.createAssessment', { name: 'T2', frameworkId: frameworks.json.result.data[0].id }, { tenantId });
    const id: string = created.json.result.data;
    await client.mutation('complianceAssessments.publishAssessment', { id }, { tenantId });

    const published = await client.mutation('complianceAssessments.deleteAssessment', { id }, { tenantId });
    expect(published.status).toBe(409);
    expect(published.json.error.data.reason).toBe('ASSESSMENT_PUBLISHED');

    await client.mutation('complianceAssessments.reopenAssessment', { id }, { tenantId });
    expect((await client.mutation('complianceAssessments.deleteAssessment', { id }, { tenantId })).status).toBe(200);
    expect((await client.mutation('complianceAssessments.deleteAssessment', { id }, { tenantId })).status).toBe(404);
  });

  describe('answer version', () => {
    let assessmentId: string;
    let requirementId: string;

    const answer = (updatedAt?: string | null) => client.mutation('complianceAssessments.answerRequirement', {
      assessmentId, requirementId, ownerId: null, dueDate: null, level: 2, notApplicable: false, comment: null,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    }, { tenantId });

    beforeEach(async () => {
      const frameworks = await client.query('complianceAssessments.getFrameworks', undefined, { tenantId });
      const created = await client.mutation('complianceAssessments.createAssessment', { name: 'T4', frameworkId: frameworks.json.result.data[0].id }, { tenantId });
      assessmentId = created.json.result.data;
      const assessment = await client.query('complianceAssessments.getAssessment', { id: assessmentId }, { tenantId });
      requirementId = assessment.json.result.data.nodes.find((node: { isRequirement: boolean }) => node.isRequirement).id;
    });

    it('should refuse an answer that does not say which version it read', async () => {
      expect((await answer()).status).toBe(400);
    });

    it('should round-trip the version read as the string a query returned', async () => {
      expect((await answer(null)).status).toBe(200);
      const assessment = await client.query('complianceAssessments.getAssessment', { id: assessmentId }, { tenantId });

      expect((await answer(assessment.json.result.data.answers[0].updatedAt)).status).toBe(200);
    });

    it('should answer a stale version with a STALE_WRITE conflict', async () => {
      await answer(null);

      const stale = await answer(null);

      expect(stale.status).toBe(409);
      expect(stale.json.error.data.reason).toBe('STALE_WRITE');
    });
  });
});
