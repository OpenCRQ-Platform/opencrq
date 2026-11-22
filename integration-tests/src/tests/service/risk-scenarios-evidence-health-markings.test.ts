import type { ConnectorAssetInput, EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

/**
 * The evidence health of a scenario names each reached asset with its markings (CTEM marking
 * parity, G5): XTM One's CTEM loop records these names where other people read them, so it must
 * know which ones are marked. A reader without the clearance never gets the marked asset at all.
 */
describe('Evidence health carries the markings of the assets it names', () => {
  let adminOrigin: EventOrigin;
  let memberOrigin: EventOrigin;
  let scenarioId: string;
  let redId: string;
  let openId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    memberOrigin = (await createTenantUser(services, db, adminOrigin)).origin;

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test OpenAEV Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
    const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId: setup.tenantId };
    const input = (sourceAssetId: string, name: string, markingRefs?: Array<string>): ConnectorAssetInput => ({
      sourceAssetId,
      categoryId: 'host',
      connectorId,
      source: 'openaev',
      name,
      ...(markingRefs ? { markingRefs } : {}),
      properties: { family: 'machine', hostname: `${name}.corp.example` },
    });
    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      input('oaev-red', 'srv-red', [TLP_RED]),
      input('oaev-open', 'srv-open'),
    ]);
    redId = idMap.get('oaev-red')!;
    openId = idMap.get('oaev-open')!;

    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Test Organization' }]);
    const primaryAssetId = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Card Transaction Data', description: null, ownerId: null, businessValueCategoryIds: [],
    });
    await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
      { id: uuidv7(), supportingAssetId: redId, primaryAssetId, roles: ['stores'] },
      { id: uuidv7(), supportingAssetId: openId, primaryAssetId, roles: ['stores'] },
    ]);
    const attackOutcomeId = (await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes())[0].id;
    scenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: scenarioId, organizationId, name: 'Evidence Scenario', description: null, attackOutcomeId, primaryAssetIds: [primaryAssetId],
    });
  });

  it('should name each asset with its markings, and the scenario with its own', async () => {
    const health = await services.withOrigin(adminOrigin).riskScenarios.getEvidenceHealth(scenarioId, 30, 100);

    const markingsOf = new Map(health!.assets.map((asset) => [asset.supportingAssetId, asset.markingRefs]));
    expect(markingsOf.get(redId)).toEqual([TLP_RED]);
    expect(markingsOf.get(openId)).toEqual([]);
    expect(health!.markingRefs).toEqual([]);
  });

  it('should leave the marked asset out for a reader without the clearance', async () => {
    const health = await services.withOrigin(memberOrigin).riskScenarios.getEvidenceHealth(scenarioId, 30, 100);

    const ids = health!.assets.map((asset) => asset.supportingAssetId);
    expect(ids).toContain(openId);
    expect(ids).not.toContain(redId);
  });
});
