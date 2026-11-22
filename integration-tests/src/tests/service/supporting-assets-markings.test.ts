import type { ConnectorAssetInput, EventOrigin } from '@app/module';
import { supportingAssets } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';
const UNDEFINED_MARKING = 'oaev-marking-the-tenant-does-not-define';

/**
 * An asset a connector reports with markings (CTEM marking parity, G4: OpenAEV's `asset_markings`
 * as STIX ids) carries them on `marking_refs`, the union over its sources, and is read under the
 * reader's OpenCRQ clearance: hidden from a member who holds none of them, its detail not found;
 * an unmarked asset stays visible to all; a marking no clearance names hides the asset (fail closed).
 */
describe('OpenCRQ clearance on connector-marked supporting assets', () => {
  let adminOrigin: EventOrigin;
  let memberOrigin: EventOrigin;
  let connectorOrigin: EventOrigin;
  let connectorId: string;

  const input = (sourceAssetId: string, name: string, markingRefs?: Array<string>): ConnectorAssetInput => ({
    sourceAssetId,
    categoryId: 'host',
    connectorId,
    source: 'openaev',
    name,
    ...(markingRefs ? { markingRefs } : {}),
    properties: { family: 'machine', hostname: `${name}.corp.example` },
  });

  const markingsOf = async (assetId: string) =>
    (await db.select({ markingRefs: supportingAssets.markingRefs }).from(supportingAssets).where(eq(supportingAssets.id, assetId)))[0].markingRefs;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    memberOrigin = (await createTenantUser(services, db, adminOrigin)).origin;
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test OpenAEV Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
    connectorOrigin = { type: 'connector', serviceAccountId, tenantId: setup.tenantId };
  });

  it('should project the source markings onto the asset, and hide it from a member without clearance', async () => {
    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      input('oaev-red', 'srv-red', [TLP_RED]),
      input('oaev-open', 'srv-open'),
    ]);
    const redId = idMap.get('oaev-red')!;
    const openId = idMap.get('oaev-open')!;
    expect(await markingsOf(redId)).toEqual([TLP_RED]);
    expect(await markingsOf(openId)).toEqual([]);

    expect(await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(redId)).not.toBeNull();
    expect(await services.withOrigin(memberOrigin).supportingAssets.getSupportingAsset(redId)).toBeNull();
    expect(await services.withOrigin(memberOrigin).supportingAssets.getSupportingAsset(openId)).not.toBeNull();
  });

  it('should hide an asset carrying a marking no clearance names', async () => {
    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      input('oaev-unknown', 'srv-unknown', [UNDEFINED_MARKING]),
    ]);
    expect(await services.withOrigin(memberOrigin).supportingAssets.getSupportingAsset(idMap.get('oaev-unknown')!)).toBeNull();
  });

  it('should clear the asset markings when the source no longer states any', async () => {
    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([input('oaev-red', 'srv-red', [TLP_RED])]);
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([input('oaev-red', 'srv-red')]);
    expect(await markingsOf(idMap.get('oaev-red')!)).toEqual([]);
  });
});
