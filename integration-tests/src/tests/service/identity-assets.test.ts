import type { ConnectorAssetInput, EventOrigin } from '@app/module';
import { supportingAssetIdentityProperties, supportingAssets, tenants } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * The identity half of the Microsoft Graph connector: an account becomes an asset, two observations
 * of one account fold onto one asset, and the criticality the connector states travels the shipped
 * resolution path rather than being written onto the canonical row.
 */
describe('identities as assets', () => {
  let adminOrigin: EventOrigin;
  let connectorOrigin: EventOrigin;
  let connectorId: string;
  let tenantId: string;
  let adminUserId: string;

  const identityInput = (overrides: Partial<ConnectorAssetInput> & { sourceAssetId: string }): ConnectorAssetInput => ({
    categoryId: 'identity',
    connectorId,
    source: 'microsoft_graph',
    ...overrides,
  });

  const assetsOfTenant = async () => (await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
    page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
  })).items;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Test Defender Bot',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
    const resolved = await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('microsoft_graph');
    connectorId = resolved!;

    connectorOrigin = { type: 'connector', serviceAccountId, tenantId: setup.tenantId };
  });

  it('stores an identity with its subcategory, its band and its property row', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        name: 'Nadia Fournier',
        subcategoryId: 'user_account',
        criticality: 'very_high',
        properties: {
          family: 'identity',
          directoryObjectId: 'obj-1',
          cloudSid: 'S-1-12-1-4001-4002-4003-4004',
          userPrincipalName: 'N.Fournier@Acme.Example',
          accountDomain: 'ACME',
          accountName: 'nfournier',
          directoryType: 'User',
          department: 'IT',
          jobTitle: 'Directory Architect',
          isEnabled: true,
          assignedRoles: ['Global Administrator', 'global administrator'],
        },
      }),
    ]);

    const [asset] = await assetsOfTenant();
    expect(asset).toMatchObject({
      categoryId: 'identity',
      subcategoryId: 'user_account',
      criticality: 'very_high',
      name: 'Nadia Fournier',
    });

    const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(asset.id);
    expect(detail?.properties).toMatchObject({
      family: 'identity',
      directoryObjectId: 'obj-1',
      cloudSid: 'S-1-12-1-4001-4002-4003-4004',
      // Normalised on the way in: a UPN is case-insensitive, a domain is a host name, and a role
      // held both directly and through PIM arrives twice.
      userPrincipalName: 'n.fournier@acme.example',
      accountDomain: 'acme',
      directoryType: 'User',
      identityProvider: 'entra',
      assignedRoles: ['Global Administrator'],
    });
  });

  it('keeps the family block off the Sources rows, which carry what a connector reported and nothing else', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        name: 'Nadia Fournier',
        properties: { family: 'identity', directoryObjectId: 'obj-1', accountName: 'nfournier' },
      }),
    ]);
    const [asset] = await assetsOfTenant();

    const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(asset.id);

    // The block that speaks for the asset is resolved once, onto `properties`. A source row keeping
    // its own copy is a leak nothing else rejects: the summary strips them by name, so a family
    // added without a line there rides along silently.
    expect(Object.keys(detail?.sources[0] ?? {}).filter((key) => key.endsWith('Properties'))).toEqual([]);
  });

  it('derives the identity provider from which SID the source knew', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'sid:S-1-5-21-1-2-3-1101',
        name: 'acme\\tricci',
        properties: { family: 'identity', onPremSid: 'S-1-5-21-1-2-3-1101' },
      }),
    ]);

    const [asset] = await assetsOfTenant();
    const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(asset.id);
    expect(detail?.properties).toMatchObject({ identityProvider: 'active_directory' });
  });

  it('folds an account first seen in a logon event onto its later directory record', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'sid:S-1-5-21-1-2-3-1104',
        name: 'acme\\nfournier',
        properties: { family: 'identity', onPremSid: 'S-1-5-21-1-2-3-1104' },
      }),
    ]);
    expect(await assetsOfTenant()).toHaveLength(1);

    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        name: 'Nadia Fournier',
        subcategoryId: 'user_account',
        properties: {
          family: 'identity',
          directoryObjectId: 'obj-1',
          onPremSid: 'S-1-5-21-1-2-3-1104',
          cloudSid: 'S-1-12-1-4001-4002-4003-4004',
        },
      }),
    ]);

    // One account, one asset: the SID is what joins the two observations.
    const assets = await assetsOfTenant();
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe('Nadia Fournier');
  });

  it('retires the SID-keyed observation once the directory record supersedes it', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'sid:S-1-5-21-1-2-3-1104',
        name: 'acme\\nfournier',
        properties: { family: 'identity', onPremSid: 'S-1-5-21-1-2-3-1104' },
      }),
    ]);
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        name: 'Nadia Fournier',
        properties: { family: 'identity', directoryObjectId: 'obj-1', onPremSid: 'S-1-5-21-1-2-3-1104' },
      }),
    ]);

    const [beforeRetire] = await assetsOfTenant();
    const detailBefore = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(beforeRetire.id);
    expect(detailBefore?.sources).toHaveLength(2);

    await services.withOrigin(connectorOrigin).supportingAssets.retireSupersededSources({
      connectorId,
      sourceAssetIds: ['sid:S-1-5-21-1-2-3-1104'],
    });

    const [asset] = await assetsOfTenant();
    const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(asset.id);
    expect(detail?.sources).toHaveLength(1);
    expect(detail?.sources[0]?.sourceAssetId).toBe('obj-1');
    // The asset survives with the directory record's own reading, re-derived from what is left.
    expect(detail?.name).toBe('Nadia Fournier');
  });

  it('goes with its tenant when the tenant is deleted', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        name: 'Nadia Fournier',
        properties: { family: 'identity', directoryObjectId: 'obj-1', onPremSid: 'S-1-5-21-1-2-3-1104' },
      }),
    ]);
    expect(await db.select().from(supportingAssetIdentityProperties)
      .where(eq(supportingAssetIdentityProperties.tenantId, tenantId))).toHaveLength(1);

    await services.withOrigin({ type: 'platform', userId: adminUserId }).tenants.deleteTenants([tenantId]);

    expect(await db.select().from(tenants).where(eq(tenants.id, tenantId))).toHaveLength(0);
    expect(await db.select().from(supportingAssetIdentityProperties)
      .where(eq(supportingAssetIdentityProperties.tenantId, tenantId))).toHaveLength(0);
  });

  it('resolves the most severe band two connectors report, never the last one to write', async () => {
    const otherServiceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: otherServiceAccountId, name: 'Test OpenAEV Bot',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', otherServiceAccountId);
    const openaevConnectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        criticality: 'very_high',
        properties: { family: 'identity', directoryObjectId: 'obj-1', cloudSid: 'S-1-12-1-7-7-7-7' },
      }),
    ]);
    await services.withOrigin({ type: 'connector', serviceAccountId: otherServiceAccountId, tenantId })
      .supportingAssets.bulkUpsertAssets([
        {
          categoryId: 'identity',
          connectorId: openaevConnectorId,
          source: 'openaev',
          sourceAssetId: 'openaev-1',
          criticality: 'low',
          properties: { family: 'identity', directoryObjectId: 'obj-1', cloudSid: 'S-1-12-1-7-7-7-7' },
        },
      ]);

    const assets = await assetsOfTenant();
    expect(assets).toHaveLength(1);
    expect(assets[0].criticality).toBe('very_high');
  });

  it('lets a hand-pinned band survive a sync that reports a different one', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        name: 'Nadia Fournier',
        criticality: 'unknown',
        properties: { family: 'identity', directoryObjectId: 'obj-1' },
      }),
    ]);
    const [asset] = await assetsOfTenant();

    await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(asset.id, { criticality: 'very_high' });

    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        name: 'Nadia Fournier',
        criticality: 'low',
        properties: { family: 'identity', directoryObjectId: 'obj-1' },
      }),
    ]);

    const [afterSync] = await assetsOfTenant();
    expect(afterSync.criticality).toBe('very_high');
  });

  it('keeps two accounts apart when nothing joins them', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({ sourceAssetId: 'obj-1', properties: { family: 'identity', directoryObjectId: 'obj-1' } }),
      identityInput({ sourceAssetId: 'obj-2', properties: { family: 'identity', directoryObjectId: 'obj-2' } }),
    ]);

    expect(await assetsOfTenant()).toHaveLength(2);
  });

  it('clears the identity property row when a source changes family', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({ sourceAssetId: 'shifting', properties: { family: 'identity', directoryObjectId: 'obj-1' } }),
    ]);
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      {
        categoryId: 'host',
        connectorId,
        source: 'microsoft_graph',
        sourceAssetId: 'shifting',
        properties: { family: 'machine', hostname: 'srv-01.acme.example' },
      },
    ]);

    const [asset] = await assetsOfTenant();
    const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(asset.id);
    // The machine row must not be shadowed by the identity row the source no longer reports.
    expect(detail?.properties).toMatchObject({ family: 'machine', hostname: 'srv-01.acme.example' });
  });

  it('gives a hand-made identity the block a person typed, with the directory they stated', async () => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id, name: 'External auditor', description: null, ownerId: null, exposure: 'unknown', categoryId: 'identity',
      properties: { family: 'identity', userPrincipalName: 'auditor@example.com', identityProvider: 'entra', assignedRoles: ['Global Reader'] },
    });

    const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
    const typed = { family: 'identity', userPrincipalName: 'auditor@example.com', identityProvider: 'entra', assignedRoles: ['Global Reader'], cloudSid: null };
    expect(detail?.properties).toMatchObject(typed);
    expect(detail?.manualProperties).toMatchObject(typed);
  });

  it('completes a connector\'s identity by hand field by field, the directory\'s other fields kept', async () => {
    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({
        sourceAssetId: 'obj-1',
        properties: { family: 'identity', directoryObjectId: 'obj-1', userPrincipalName: 'jdoe@acme.example', department: 'IT' },
      }),
    ]);
    const assetId = idMap.get('obj-1')!;
    await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, {
      properties: { family: 'identity', department: 'Finance' },
    });

    const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
    expect(detail?.properties).toMatchObject({ family: 'identity', directoryObjectId: 'obj-1', userPrincipalName: 'jdoe@acme.example', department: 'Finance' });
    expect(detail?.manualProperties).toMatchObject({ family: 'identity', directoryObjectId: null, userPrincipalName: null, department: 'Finance' });
    expect(detail?.propertiesByFamily.map((entry) => entry.properties.family)).toEqual(['identity']);
  });

  it('narrows the asset list to a category, and back out of it', async () => {
    await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      identityInput({ sourceAssetId: 'obj-1', name: 'An identity', properties: { family: 'identity', directoryObjectId: 'obj-1' } }),
      {
        categoryId: 'host',
        connectorId,
        source: 'microsoft_graph',
        sourceAssetId: 'dev-1',
        name: 'A host',
        properties: { family: 'machine', hostname: 'srv-01.acme.example' },
      },
    ]);

    const list = (categoryId: 'identity' | null, categoryMode: 'only' | 'except') =>
      services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1,
        limit: 50,
        search: null,
        source: null,
        categoryId,
        categoryMode,
        mappedToOrganizationId: null,
        membershipOrganizationId: null,
        sortBy: 'name',
        sortDesc: false,
      });

    expect((await list(null, 'only')).total).toBe(2);
    expect((await list('identity', 'only')).items.map((a) => a.name)).toEqual(['An identity']);
    expect((await list('identity', 'except')).items.map((a) => a.name)).toEqual(['A host']);
  });

  describe('retiring the sources of the accounts a sync no longer imports', () => {
    const upsertAccount = async (key: string, overrides: Partial<ConnectorAssetInput> = {}) => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        identityInput({ sourceAssetId: key, name: 'Old name', properties: { family: 'identity', directoryObjectId: key }, ...overrides }),
      ]);
      return idMap.get(key)!;
    };

    const retire = (keys: Array<string>) => services.withOrigin(connectorOrigin).supportingAssets.retireConnectorSources({ connectorId, sourceAssetIds: keys });

    const assetExists = async (assetId: string) => (await db.select({ id: supportingAssets.id }).from(supportingAssets).where(eq(supportingAssets.id, assetId))).length === 1;

    const tagFor = async (owner: { connectorId: string, origin: EventOrigin }, sourceTagId: string) => {
      const ids = await services.withOrigin(owner.origin).supportingAssets.upsertTagVocabulary(owner.connectorId, [{ sourceTagId, name: `Tag ${sourceTagId}`, color: '#ff0000' }]);
      return ids.get(sourceTagId)!;
    };

    const hostAsset = async (key: string) => (await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      { categoryId: 'host', connectorId, source: 'microsoft_graph', sourceAssetId: key, name: key, properties: { family: 'machine', hostname: `${key}.acme.example` } },
    ])).get(key)!;

    const handMadeAsset = async (name: string) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      return id;
    };

    const otherConnector = async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test OpenAEV Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const otherConnectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      return { connectorId: otherConnectorId, origin: { type: 'connector', serviceAccountId, tenantId } as EventOrigin };
    };

    const primaryAsset = async () => {
      const organizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name: 'Customer data', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      return id;
    };

    it('deletes an asset left with no source when nobody invested in it', async () => {
      const assetId = await upsertAccount('obj-bare');

      expect(await retire(['obj-bare'])).toEqual({ sources: 1, assets: 1 });

      expect(await assetExists(assetId)).toBe(false);
    });

    it('deletes it although the retiring connector related it to a device, that connector dropping the relation itself', async () => {
      const assetId = await upsertAccount('obj-bare');
      await services.withOrigin(connectorOrigin).supportingAssets.reconcileConnectorRelations({
        connectorId,
        kind: 'primary_user_of',
        observedAt: new Date(),
        relations: [{ fromAssetId: assetId, toAssetId: await hostAsset('dev-1'), source: 'entra_registered_owner' }],
        retiredIds: [],
      });

      expect(await retire(['obj-bare'])).toEqual({ sources: 1, assets: 1 });

      expect(await assetExists(assetId)).toBe(false);
    });

    it('deletes it although a connector tagged it, a connector\'s tag being no one\'s work', async () => {
      const assetId = await upsertAccount('obj-bare');
      const tagId = await tagFor({ connectorId, origin: connectorOrigin }, 'tag-1');
      await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [{ supportingAssetId: assetId, tagIds: [tagId] }]);

      expect(await retire(['obj-bare'])).toEqual({ sources: 1, assets: 1 });

      expect(await assetExists(assetId)).toBe(false);
    });

    it('keeps an asset that still has a source, and re-derives it from that one', async () => {
      await upsertAccount('sid:S-1-5-21-1-2-3-1104', { name: 'acme\\nfournier', properties: { family: 'identity', onPremSid: 'S-1-5-21-1-2-3-1104' } });
      const assetId = await upsertAccount('obj-1', { name: 'Nadia Fournier', properties: { family: 'identity', directoryObjectId: 'obj-1', onPremSid: 'S-1-5-21-1-2-3-1104' } });
      expect((await assetsOfTenant())).toHaveLength(1);

      expect(await retire(['obj-1'])).toEqual({ sources: 1, assets: 0 });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(detail?.sources.map((source) => source.sourceAssetId)).toEqual(['sid:S-1-5-21-1-2-3-1104']);
      expect(detail?.name).toBe('acme\\nfournier');
    });

    it('keeps an asset another connector still reports, and leaves that connector\'s source alone', async () => {
      const { connectorId: openaevConnectorId, origin: openaevOrigin } = await otherConnector();
      const assetId = await upsertAccount('obj-1', { properties: { family: 'identity', directoryObjectId: 'obj-1', cloudSid: 'S-1-12-1-7-7-7-7' } });
      await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertAssets([
        { categoryId: 'identity', connectorId: openaevConnectorId, source: 'openaev', sourceAssetId: 'obj-1', properties: { family: 'identity', directoryObjectId: 'obj-1', cloudSid: 'S-1-12-1-7-7-7-7' } },
      ]);

      expect(await retire(['obj-1'])).toEqual({ sources: 1, assets: 0 });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(detail?.sources.map((source) => source.connectorId)).toEqual([openaevConnectorId]);
    });

    describe('an asset with no source left that someone invested in', () => {
      it.each([
        ['a hand-set value', async (assetId: string) => {
          await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { criticality: 'very_high' });
        }],
        ['hand-typed properties', async (assetId: string) => {
          await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { properties: { family: 'identity', department: 'Finance' } });
        }],
        ['a tag a person set', async (assetId: string) => {
          const tagId = await tagFor({ connectorId, origin: connectorOrigin }, 'tag-1');
          await services.withOrigin(adminOrigin).supportingAssets.setAssetTags(null, [{ supportingAssetId: assetId, tagIds: [tagId] }]);
        }],
        ['an owner a person set', async (assetId: string) => {
          await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { ownerId: adminUserId });
        }],
        ['a relation another connector holds', async (assetId: string) => {
          const other = await otherConnector();
          const deviceAssetId = await hostAsset('dev-1');
          await services.withOrigin(other.origin).supportingAssets.reconcileConnectorRelations({
            connectorId: other.connectorId,
            kind: 'primary_user_of',
            observedAt: new Date(),
            relations: [{ fromAssetId: assetId, toAssetId: deviceAssetId, source: 'entra_registered_owner' }],
            retiredIds: [],
          });
        }],
        ['a dependency on a primary asset', async (assetId: string) => {
          await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
            id: uuidv7(), supportingAssetId: assetId, primaryAssetId: await primaryAsset(),
          }]);
        }],
        ['a dependency from another supporting asset', async (assetId: string) => {
          await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
            id: uuidv7(), providerAssetId: await handMadeAsset('Provider'), dependentAssetId: assetId,
          }]);
        }],
        ['a dependency of another supporting asset', async (assetId: string) => {
          await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
            id: uuidv7(), providerAssetId: assetId, dependentAssetId: await handMadeAsset('Dependent'),
          }]);
        }],
        ['a finding a person attached', async (assetId: string) => {
          await services.withOrigin(adminOrigin).cve.upsertEpssScores([{ cveId: 'CVE-2024-0001', epss: 0.05, date: '2024-01-15' }]);
          const cveRow = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0001');
          await services.withOrigin(adminOrigin).supportingAssets.createEvidence({ id: uuidv7(), supportingAssetId: assetId, cveId: cveRow!.id, userId: adminUserId });
        }],
        ['a finding a person set aside', async (assetId: string) => {
          await services.withOrigin(adminOrigin).cve.upsertEpssScores([{ cveId: 'CVE-2024-0001', epss: 0.05, date: '2024-01-15' }]);
          const cveRow = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0001');
          const evidenceId = uuidv7();
          await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertEvidence([{
            id: evidenceId, evaluatedAt: new Date(), supportingAssetId: assetId, cveId: cveRow!.id, mitreTechniqueId: null, expectationType: null, isExposed: true, connectorId, sourceFindingId: 'obj-bare:CVE-2024-0001',
          }]);
          await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
            evidenceId, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Handled elsewhere', changedByUserId: adminUserId,
          });
        }],
        ['a place in a risk scope', async (assetId: string) => {
          await services.withOrigin(adminOrigin).organizations.createOrganizations([
            { id: uuidv7(), name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetId] },
          ]);
        }],
      ])('stays, with the values it had, when it carries %s', async (_label, invest) => {
        const assetId = await upsertAccount('obj-bare');
        await invest(assetId);

        expect(await retire(['obj-bare'])).toEqual({ sources: 1, assets: 0 });

        expect(await assetExists(assetId)).toBe(true);
        const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
        expect(detail?.sources.filter((source) => source.connectorId === connectorId)).toEqual([]);
        expect(detail?.name).toBe('Old name');
      });
    });

    it('counts exactly the sources it deletes and the assets it removes', async () => {
      const removed = await upsertAccount('obj-removed');
      const invested = await upsertAccount('obj-invested');
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(invested, { criticality: 'high' });
      await upsertAccount('sid:S-1-5-21-1-2-3-1104', { properties: { family: 'identity', onPremSid: 'S-1-5-21-1-2-3-1104' } });
      const folded = await upsertAccount('obj-folded', { properties: { family: 'identity', directoryObjectId: 'obj-folded', onPremSid: 'S-1-5-21-1-2-3-1104' } });
      await upsertAccount('obj-untouched');

      const outcome = await retire(['obj-removed', 'obj-invested', 'obj-folded', 'obj-never-seen']);

      expect(outcome).toEqual({ sources: 3, assets: 1 });
      expect(await assetExists(removed)).toBe(false);
      expect(await assetExists(invested)).toBe(true);
      expect(await assetExists(folded)).toBe(true);
      expect(await assetsOfTenant()).toHaveLength(3);
    });

    it('does nothing for an empty list', async () => {
      await upsertAccount('obj-1');

      expect(await retire([])).toEqual({ sources: 0, assets: 0 });

      expect(await assetsOfTenant()).toHaveLength(1);
    });

    it('keeps a known account the directory reports disabled with its name, marked disabled', async () => {
      const assetId = await upsertAccount('obj-1', { name: 'Nadia Fournier', properties: { family: 'identity', directoryObjectId: 'obj-1', isEnabled: true } });
      await upsertAccount('obj-1', { name: 'Nadia Fournier', properties: { family: 'identity', directoryObjectId: 'obj-1', isEnabled: false } });

      expect(await retire([])).toEqual({ sources: 0, assets: 0 });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(detail).toMatchObject({ name: 'Nadia Fournier', properties: { family: 'identity', isEnabled: false } });
    });
  });
});
