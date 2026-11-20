import type { EventOrigin } from '@app/module';
import { AttackOutcome_Ransomware, deriveSeedId, tefEstimates } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('CRQ Indicators: the TEF of a risk scope\'s scenarios', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;

  const createScenario = async (name: string, scopeId = organizationId): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id,
      organizationId: scopeId,
      name,
      description: null,
      attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
      primaryAssetIds: [],
    });
    return id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
  });

  it('should give an auto scenario its latest estimate, and none before the first', async () => {
    const estimated = await createScenario('Estimated');
    await createScenario('Not estimated yet');
    await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(estimated, tenantId);
    const latest = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(estimated, tenantId);

    const tefs = await services.withOrigin(adminOrigin).crqIndicators.getScopeScenarioTefs(organizationId);

    expect(tefs).toEqual([
      {
        id: estimated,
        name: 'Estimated',
        attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_Ransomware),
        tefMode: 'auto',
        likely: latest.likely,
        read: expect.objectContaining({ catalogue: { id: latest.catalogId, version: latest.catalogVersion }, low: latest.min, likely: latest.likely, high: latest.max, sizeSource: 'none' }),
      },
      expect.objectContaining({ name: 'Not estimated yet', tefMode: 'auto', likely: null, read: null }),
    ]);
  });

  it('should give an auto scenario the latest of its estimates', async () => {
    const estimated = await createScenario('Estimated');
    const estimate = (likely: number, createdAt: Date) =>
      ({ id: uuidv7(), riskScenarioId: estimated, catalogVintage: 1, min: likely / 2, likely, max: likely * 2, positioned: true, createdAt });
    await db.insert(tefEstimates).values([estimate(2, new Date()), estimate(1, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))]);

    const tefs = await services.withOrigin(adminOrigin).crqIndicators.getScopeScenarioTefs(organizationId);

    expect(tefs.map(({ likely }) => likely)).toEqual([2]);
  });

  it('should give a manual scenario the likely value typed by hand, the auto one it was switched from until then', async () => {
    const typed = await createScenario('Typed');
    const switched = await createScenario('Switched');
    const auto = await services.withOrigin(adminOrigin).crqIndicators.resolveAutoTef(switched, tenantId);
    await services.withOrigin(adminOrigin).crqIndicators.setTefMode(switched, 'manual', tenantId);
    await services.withOrigin(adminOrigin).crqIndicators.setTefMode(typed, 'manual', tenantId);
    await services.withOrigin(adminOrigin).crqIndicators.upsertTefInput({ riskScenarioId: typed, min: 0.2, likely: 0.5, max: 2 });

    const tefs = await services.withOrigin(adminOrigin).crqIndicators.getScopeScenarioTefs(organizationId);

    expect(tefs.map(({ name, tefMode, likely }) => ({ name, tefMode, likely }))).toEqual([
      { name: 'Switched', tefMode: 'manual', likely: Math.round(auto.likely * 1000) / 1000 },
      { name: 'Typed', tefMode: 'manual', likely: 0.5 },
    ]);
  });

  it('should leave out the scenarios of another risk scope', async () => {
    const otherScopeId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherScopeId, name: 'Other scope' }]);
    await createScenario('Here');
    await createScenario('Elsewhere', otherScopeId);

    const tefs = await services.withOrigin(adminOrigin).crqIndicators.getScopeScenarioTefs(organizationId);

    expect(tefs.map((tef) => tef.name)).toEqual(['Here']);
  });

  describe('tenant isolation', () => {
    it('should serve a caller from another tenant none of this risk scope\'s scenarios', async () => {
      await createScenario('Here');
      const adminUserId = adminOrigin.type === 'client' ? adminOrigin.userId : '';
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const outsider = await createTenantUser(services, db, otherOrigin);
      const claimingThisTenant: EventOrigin = { type: 'client', userId: outsider.userId, tenantId };

      const tefs = await services.withOrigin(claimingThisTenant).crqIndicators.getScopeScenarioTefs(organizationId);

      expect(tefs).toEqual([]);
    });
  });
});
