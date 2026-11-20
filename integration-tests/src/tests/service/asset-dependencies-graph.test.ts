import type { AssetCriticality, EventOrigin, EvidenceState, SeverityBand } from '@app/module';
import { assetEvidenceHistory, assetPostures, cve, DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET, findingScores, PrimaryAssetNotFoundError, supportingAssets } from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Asset Dependencies Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let primaryAssetId: string;
  let supportingAssetId: string;
  let supportingAssetId2: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;

    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{
      id: organizationId, name: 'Test Org',
    }]);

    primaryAssetId = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Customer Data', description: null, ownerId: null, businessValueCategoryIds: [],
    });

    supportingAssetId = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id: supportingAssetId, name: 'Database Server', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });

    supportingAssetId2 = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id: supportingAssetId2, name: 'Web Server', description: null, ownerId: null, exposure: 'internet_facing', categoryId: 'host',
    });
  });

  describe('dependency graph', () => {
    const asset = async (name: string, over: { criticality?: AssetCriticality } = {}) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host', ...over,
      });
      return id;
    };
    const supports = async (supportingId: string) =>
      services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: supportingId, primaryAssetId,
      }]);
    const dependsOn = async (dependentAssetId: string, providerAssetId: string) =>
      services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId, dependentAssetId,
      }]);
    const graph = (depth: number) =>
      services.withOrigin(adminOrigin).assetDependencies.getPrimaryAssetDependencyGraph(primaryAssetId, depth);

    it('should walk the whole chain below the primary asset, every link pointing at the provider', async () => {
      const app = await asset('srv-fact-app-01');
      const api = await asset('api-facturation');
      const store = await asset('db-fact-prod');
      const hypervisor = await asset('esx-cluster-02');
      const vcenter = await asset('vcenter-prod');
      await supports(app);
      await supports(api);
      await supports(store);
      await dependsOn(app, hypervisor);
      await dependsOn(hypervisor, vcenter);

      const result = await graph(4);

      expect(result.assets.map((a) => a.id).sort()).toEqual([app, api, store, hypervisor, vcenter].sort());
      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: primaryAssetId, providerId: app }));
      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: app, providerId: hypervisor }));
      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: hypervisor, providerId: vcenter }));
      expect(result.links.every((link) => link.kind === 'depends_on')).toBe(true);
    });

    it('should return an asset two branches depend on once, with one link per branch', async () => {
      const app = await asset('srv-fact-app-01');
      const store = await asset('db-fact-prod');
      const cluster = await asset('esx-cluster-02');
      await supports(app);
      await supports(store);
      await dependsOn(app, cluster);
      await dependsOn(store, cluster);

      const result = await graph(4);

      expect(result.assets.filter((a) => a.id === cluster)).toHaveLength(1);
      expect(result.links.filter((link) => link.providerId === cluster).map((link) => link.dependentId).sort())
        .toEqual([app, store].sort());
    });

    it('should terminate on a stored cycle and list each asset once', async () => {
      const a = await asset('a');
      const b = await asset('b');
      await supports(a);
      await dependsOn(a, b);
      await dependsOn(b, a);

      const result = await graph(6);

      expect(result.assets.map((x) => x.id).sort()).toEqual([a, b].sort());
    });

    it('should stop at the asked depth and say how many providers each cut asset hides', async () => {
      const app = await asset('srv-fact-app-01');
      const hypervisor = await asset('esx-cluster-02');
      const storage = await asset('stockage-san-01');
      const vcenter = await asset('vcenter-prod');
      await supports(app);
      await dependsOn(app, hypervisor);
      await dependsOn(app, storage);
      await dependsOn(hypervisor, vcenter);

      const result = await graph(1);

      expect(result.assets.map((x) => x.id)).toEqual([app]);
      expect(result.truncated).toEqual([{ assetId: app, hiddenProviderCount: 2, foldedBy: 'depth' }]);
    });

    it('should count every asset the chain reaches past the depth, however far', async () => {
      const app = await asset('srv-fact-app-01');
      const hypervisor = await asset('esx-cluster-02');
      const storage = await asset('stockage-san-01');
      const vcenter = await asset('vcenter-prod');
      await supports(app);
      await dependsOn(app, hypervisor);
      await dependsOn(app, storage);
      await dependsOn(hypervisor, vcenter);

      const result = await graph(1);

      expect(result.hiddenAssetCount).toBe(3);
    });

    it('should count a hidden provider two cut assets share once', async () => {
      const app = await asset('srv-fact-app-01');
      const store = await asset('db-fact-prod');
      const cluster = await asset('esx-cluster-02');
      await supports(app);
      await supports(store);
      await dependsOn(app, cluster);
      await dependsOn(store, cluster);

      const result = await graph(1);

      expect(result.truncated).toHaveLength(2);
      expect(result.hiddenAssetCount).toBe(1);
    });

    it('should end the count on a cycle past the depth', async () => {
      const app = await asset('srv-fact-app-01');
      const a = await asset('a');
      const b = await asset('b');
      await supports(app);
      await dependsOn(app, a);
      await dependsOn(a, b);
      await dependsOn(b, a);

      const result = await graph(1);

      expect(result.hiddenAssetCount).toBe(2);
    });

    it('should not count a provider the depth already drew as hidden', async () => {
      const app = await asset('srv-fact-app-01');
      const store = await asset('db-fact-prod');
      const vcenter = await asset('vcenter-prod');
      await supports(app);
      await supports(store);
      await dependsOn(app, store);
      await dependsOn(store, vcenter);

      const result = await graph(1);

      expect(result.assets.map((x) => x.id).sort()).toEqual([app, store].sort());
      expect(result.truncated).toEqual([{ assetId: store, hiddenProviderCount: 1, foldedBy: 'depth' }]);
    });

    it('should report no truncation once the whole chain is drawn', async () => {
      const app = await asset('srv-fact-app-01');
      await supports(app);

      const result = await graph(3);

      expect(result.truncated).toEqual([]);
      expect(result.hiddenAssetCount).toBe(0);
    });

    it('should carry what a node and its panel show', async () => {
      const app = await asset('srv-fact-app-01', { criticality: 'high' });
      await supports(app);

      const result = await graph(2);

      expect(result.assets[0]).toEqual(expect.objectContaining({
        id: app, name: 'srv-fact-app-01', categoryId: 'host', criticality: 'high', exposure: 'unknown',
      }));
    });

    it('should carry the roles of a link to the primary asset, and none on a link between supporting assets', async () => {
      const store = await asset('db-fact-prod');
      const cluster = await asset('esx-cluster-02');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: store, primaryAssetId, roles: ['stores', 'processes'],
      }]);
      await dependsOn(store, cluster);

      const result = await graph(2);

      expect(result.links).toContainEqual(expect.objectContaining({
        dependentId: primaryAssetId, providerId: store, roles: ['stores', 'processes'],
      }));
      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: store, providerId: cluster, roles: null }));
    });

    it('should return both links of a mutual dependency', async () => {
      const app = await asset('srv-fact-app-01');
      const a = await asset('esx-cluster-02');
      const b = await asset('esx-cluster-03');
      await supports(app);
      await dependsOn(app, a);
      await dependsOn(a, b);
      await dependsOn(b, a);

      const result = await graph(4);

      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: a, providerId: b }));
      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: b, providerId: a }));
    });

    it('should keep both links of a mutual dependency whose second asset sits on the last level', async () => {
      const app = await asset('srv-fact-app-01');
      const a = await asset('esx-cluster-02');
      const b = await asset('esx-cluster-03');
      await supports(app);
      await dependsOn(app, a);
      await dependsOn(a, b);
      await dependsOn(b, a);

      const result = await graph(3);

      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: a, providerId: b }));
      expect(result.links).toContainEqual(expect.objectContaining({ dependentId: b, providerId: a }));
      expect(result.truncated).toEqual([]);
    });

    it('should refuse a primary asset of another tenant', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const otherTenantOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      await expect(
        services.withOrigin(otherTenantOrigin).assetDependencies.getPrimaryAssetDependencyGraph(primaryAssetId, 3),
      ).rejects.toThrow(PrimaryAssetNotFoundError);
    });

    describe('findings on a node', () => {
      /** The recompute job is the only writer of the two projections, so they are seeded by hand. */
      const scoredFinding = async (
        assetId: string,
        band: SeverityBand,
        { state = 'applicable', tenantId = adminTenantId }: { state?: EvidenceState, tenantId?: string } = {},
      ) => {
        const cveId = uuidv7();
        await db.insert(cve).values([{ id: cveId, tenantId: adminTenantId, cveId: `CVE-2026-${cveId.slice(-5)}` }]);
        const evidenceId = uuidv7();
        await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
          id: evidenceId, supportingAssetId: assetId, cveId, userId: adminUserId, changedByUserId: adminUserId,
        });
        await db.insert(findingScores).values({
          assetEvidenceId: evidenceId,
          tenantId,
          score: 50,
          band,
          exploitability: 0.5,
          impact: 0.5,
        });
        if (state === 'dismissed') {
          await db.insert(assetEvidenceHistory).values({
            id: uuidv7(), tenantId, assetEvidenceId: evidenceId, state, stateChangedAt: new Date(Date.now() + 1000), origin: 'user',
          });
        }
      };
      const posture = (assetId: string, score: number) =>
        db.insert(assetPostures).values({ supportingAssetId: assetId, tenantId: adminTenantId, score });

      it('should carry the posture score and the applicable critical and high findings by score band', async () => {
        const app = await asset('srv-fact-app-01');
        await supports(app);
        await posture(app, 30);
        await scoredFinding(app, 'critical');
        await scoredFinding(app, 'critical');
        await scoredFinding(app, 'high');
        await scoredFinding(app, 'medium');
        await scoredFinding(app, 'critical', { state: 'dismissed' });

        const result = await graph(2);

        expect(result.assets[0]).toEqual(expect.objectContaining({
          id: app, postureScore: 30, criticalFindingCount: 2, highFindingCount: 1,
        }));
      });

      it('should carry no posture and no count for an asset without a scored finding', async () => {
        const app = await asset('srv-fact-app-01');
        await supports(app);

        const result = await graph(2);

        expect(result.assets[0]).toEqual(expect.objectContaining({
          id: app, postureScore: null, criticalFindingCount: 0, highFindingCount: 0,
        }));
      });

      it('should carry them on every asset of the walk around a supporting asset, the asset itself included', async () => {
        const store = await asset('db-fact-prod');
        const cluster = await asset('esx-cluster-02');
        await supports(store);
        await dependsOn(store, cluster);
        await posture(store, 80);
        await scoredFinding(cluster, 'high');

        const result = await services.withOrigin(adminOrigin).assetDependencies.getSupportingAssetDependencyGraph(store, 3);

        expect(result.assets).toContainEqual(expect.objectContaining({
          id: store, postureScore: 80, criticalFindingCount: 0, highFindingCount: 0,
        }));
        expect(result.assets).toContainEqual(expect.objectContaining({
          id: cluster, postureScore: null, criticalFindingCount: 0, highFindingCount: 1,
        }));
      });

      it('should not count a score row another tenant holds', async () => {
        const tenantBId = await createTenant(services, adminUserId);
        const app = await asset('srv-fact-app-01');
        await supports(app);
        await scoredFinding(app, 'critical', { tenantId: tenantBId });

        const result = await graph(2);

        expect(result.assets[0]).toEqual(expect.objectContaining({ id: app, criticalFindingCount: 0 }));
      });
    });

    describe('around a supporting asset', () => {
      const around = (assetId: string, depth: number) =>
        services.withOrigin(adminOrigin).assetDependencies.getSupportingAssetDependencyGraph(assetId, depth);

      it('should count the providers of an asset folded among the providers yet drawn as a dependent', async () => {
        const center = await asset('Center');
        const leafIds = Array.from({ length: DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET }, () => uuidv7());
        const linkIds = Array.from({ length: DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET }, () => uuidv7());
        // The replica role skips the per-row notification triggers and the FK checks, as a bulk seed does.
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('session_replication_role', 'replica', true)`);
          await tx.execute(sql`INSERT INTO supporting_assets (id, tenant_id, name, category_id)
            SELECT id, ${adminTenantId}, 'Leaf ' || lpad(n::text, 3, '0'), 'host' FROM unnest(${sql.param(leafIds)}::uuid[]) WITH ORDINALITY AS t(id, n)`);
          await tx.execute(sql`INSERT INTO support_to_support_links (id, tenant_id, provider_asset_id, dependent_asset_id)
            SELECT id, ${adminTenantId}, provider_asset_id, ${center} FROM unnest(${sql.param(linkIds)}::uuid[], ${sql.param(leafIds)}::uuid[]) AS t(id, provider_asset_id)`);
        });
        const mutual = await asset('Zulu');
        const beyond = await asset('Yankee');
        await dependsOn(center, mutual);
        await dependsOn(mutual, center);
        await dependsOn(mutual, beyond);

        const result = await around(center, 2);

        expect(result.assets.map((a) => a.id)).toContain(mutual);
        expect(result.assets.map((a) => a.id)).not.toContain(beyond);
        expect(result.truncated).toEqual([{ assetId: mutual, hiddenProviderCount: 1, foldedBy: 'width' }]);
        expect(result.hiddenAssetCount).toBe(1);
      });

      it('should count the providers past a chain the dependents\' walk drew from an asset folded among the providers', async () => {
        const center = await asset('Center');
        const leafIds = Array.from({ length: DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET }, () => uuidv7());
        const linkIds = Array.from({ length: DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET }, () => uuidv7());
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('session_replication_role', 'replica', true)`);
          await tx.execute(sql`INSERT INTO supporting_assets (id, tenant_id, name, category_id)
            SELECT id, ${adminTenantId}, 'Leaf ' || lpad(n::text, 3, '0'), 'host' FROM unnest(${sql.param(leafIds)}::uuid[]) WITH ORDINALITY AS t(id, n)`);
          await tx.execute(sql`INSERT INTO support_to_support_links (id, tenant_id, provider_asset_id, dependent_asset_id)
            SELECT id, ${adminTenantId}, provider_asset_id, ${center} FROM unnest(${sql.param(linkIds)}::uuid[], ${sql.param(leafIds)}::uuid[]) AS t(id, provider_asset_id)`);
        });
        const folded = await asset('Zulu');
        const between = await asset('Papa');
        const beyond = await asset('Yankee');
        await dependsOn(center, folded);
        await dependsOn(folded, between);
        await dependsOn(between, center);
        await dependsOn(between, beyond);

        const result = await around(center, 2);

        expect(result.assets.map((a) => a.id)).toEqual(expect.arrayContaining([folded, between]));
        expect(result.assets.map((a) => a.id)).not.toContain(beyond);
        expect(result.truncated).toEqual([{ assetId: between, hiddenProviderCount: 1, foldedBy: 'width' }]);
        expect(result.hiddenAssetCount).toBe(1);
      });

      it('should walk what the asset supports up to the primary asset, and what supports it', async () => {
        const app = await asset('srv-fact-app-01');
        const store = await asset('db-fact-prod');
        const cluster = await asset('esx-cluster-02');
        const vcenter = await asset('vcenter-prod');
        await supports(app);
        await dependsOn(app, store);
        await dependsOn(store, cluster);
        await dependsOn(cluster, vcenter);

        const result = await around(store, 3);

        expect(result.assets.map((a) => a.id).sort()).toEqual([store, app, cluster, vcenter].sort());
        expect(result.primaryAssets).toEqual([{ id: primaryAssetId, name: 'Customer Data' }]);
        expect(result.links).toContainEqual(expect.objectContaining({ dependentId: primaryAssetId, providerId: app }));
        expect(result.links).toContainEqual(expect.objectContaining({ dependentId: app, providerId: store }));
        expect(result.links).toContainEqual(expect.objectContaining({ dependentId: store, providerId: cluster }));
        expect(result.links).toContainEqual(expect.objectContaining({ dependentId: cluster, providerId: vcenter }));
      });

      it('should carry the roles of the asset\'s own link to a primary asset', async () => {
        const store = await asset('db-fact-prod');
        await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
          id: uuidv7(), supportingAssetId: store, primaryAssetId, roles: ['stores'],
        }]);

        const result = await around(store, 1);

        expect(result.links).toEqual([expect.objectContaining({ dependentId: primaryAssetId, providerId: store, roles: ['stores'] })]);
      });

      it('should stop at the depth on both sides and count what it cuts on each', async () => {
        const top = await asset('a');
        const above = await asset('b');
        const store = await asset('db-fact-prod');
        const below = await asset('c');
        const bottom = await asset('d');
        await supports(top);
        await dependsOn(top, above);
        await dependsOn(above, store);
        await dependsOn(store, below);
        await dependsOn(below, bottom);

        const result = await around(store, 1);

        expect(result.assets.map((a) => a.id).sort()).toEqual([store, above, below].sort());
        expect(result.primaryAssets).toEqual([]);
        expect(result.truncated).toEqual([{ assetId: below, hiddenProviderCount: 1, foldedBy: 'depth' }]);
        expect(result.hiddenAssetCount).toBe(2);
      });

      it('should draw a cycle through the asset once, each link once', async () => {
        const store = await asset('db-fact-prod');
        const cluster = await asset('esx-cluster-02');
        await dependsOn(store, cluster);
        await dependsOn(cluster, store);

        const result = await around(store, 3);

        expect(result.assets.map((a) => a.id).sort()).toEqual([store, cluster].sort());
        expect(result.links).toHaveLength(2);
        expect(result.links).toContainEqual(expect.objectContaining({ dependentId: store, providerId: cluster }));
        expect(result.links).toContainEqual(expect.objectContaining({ dependentId: cluster, providerId: store }));
      });

      it('should return the asset alone when nothing links it', async () => {
        const store = await asset('db-fact-prod');

        const result = await around(store, 3);

        expect(result.assets.map((a) => a.id)).toEqual([store]);
        expect(result.links).toEqual([]);
        expect(result.primaryAssets).toEqual([]);
      });

      it('should refuse a supporting asset of another tenant', async () => {
        const tenantBId = await createTenant(services, adminUserId);
        const otherTenantOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

        await expect(
          services.withOrigin(otherTenantOrigin).assetDependencies.getSupportingAssetDependencyGraph(supportingAssetId, 3),
        ).rejects.toThrow();
      });
    });
  });

  describe('an asset with no name, known by its derived name', () => {
    let addressId: string;

    beforeEach(async () => {
      addressId = uuidv7();
      await db.insert(supportingAssets).values({
        id: addressId, tenantId: adminTenantId, name: null, derivedName: '10.0.0.1', exposure: 'internal', categoryId: 'host', criticality: 'low',
      });
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: addressId, primaryAssetId }]);
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([
        { id: uuidv7(), providerAssetId: addressId, dependentAssetId: supportingAssetId },
        { id: uuidv7(), providerAssetId: supportingAssetId2, dependentAssetId: addressId },
      ]);
    });

    it('should carry its derived name wherever a dependency names it', async () => {
      const dependencies = services.withOrigin(adminOrigin).assetDependencies;

      const [primaryLink] = await dependencies.getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);
      expect([primaryLink.supportingAssetName, primaryLink.supportingAssetDerivedName]).toEqual([null, '10.0.0.1']);

      const supportLinks = await dependencies.getSupportToSupportLinks(supportingAssetId);
      expect(supportLinks.map((link) => [link.relatedAssetName, link.relatedAssetDerivedName])).toEqual([[null, '10.0.0.1']]);
      const providedBy = await dependencies.getSupportToSupportLinks(supportingAssetId2);
      expect(providedBy.map((link) => [link.relatedAssetName, link.relatedAssetDerivedName])).toEqual([[null, '10.0.0.1']]);

      const primaryGraph = await dependencies.getPrimaryAssetDependencyGraph(primaryAssetId, 2);
      expect(primaryGraph.assets.find((asset) => asset.id === addressId)).toMatchObject({ name: null, derivedName: '10.0.0.1' });
      expect(primaryGraph.assets.find((asset) => asset.id === supportingAssetId2)).toMatchObject({ name: 'Web Server', derivedName: null });

      const around = await dependencies.getSupportingAssetDependencyGraph(addressId, 1);
      expect(around.assets.find((asset) => asset.id === addressId)).toMatchObject({ name: null, derivedName: '10.0.0.1' });
      expect(around.assets.find((asset) => asset.id === supportingAssetId2)).toMatchObject({ name: 'Web Server', derivedName: null });
    });

    it('should carry its derived name in the candidate rows', async () => {
      const result = await services.withOrigin(adminOrigin).supportingAssets.listDependencyCandidates({
        page: 1, limit: 50, search: null, source: null, categoryId: null,
        dependency: { relation: 'dependsOn', assetId: supportingAssetId, linkedOnly: false },
      });

      expect(result.items.find((row) => row.id === addressId)).toMatchObject({ name: null, derivedName: '10.0.0.1' });
    });
  });
});
