import type { EventOrigin, ScenarioFindingsQuery, ScenarioPageQuery, ScenarioSupportingAssetSortKey, SupportToPrimaryLinkRole } from '@app/module';
import {
  assetEvidence,
  AttackOutcome_Ransomware,
  crqIndicatorRuns,
  cve,
  DEPENDENCY_GRAPH_MAX_ASSETS,
  DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET,
  deriveSeedId,
  findingScores,
  SEVERITY_BAND_MINIMUMS,
  supportingAssets,
  wholePercent,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { recomputePrimaryAssetReach } from '../../helpers/primary-asset-reach';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Risk Scenarios Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let organizationId: string;
  let attackOutcomeId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: organizationId, name: 'Test Organization' },
    ]);

    // Get seeded attack outcomes (auto-created at tenant creation)
    const attackOutcomes = await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes();
    attackOutcomeId = attackOutcomes[0].id;
  });

  /** Every finding of the scenario, whatever its state, on one page. */
  const findingsOf = async (origin: EventOrigin, scenarioId: string) => {
    await recomputePrimaryAssetReach(services, adminTenantId);
    return (await services.withOrigin(origin).riskScenarios
      .listFindingsForRiskScenario(scenarioId, { page: 1, limit: 500, sortDesc: true, state: 'all', severity: 'all' })).items;
  };

  /** Named `Bulk 000001` upwards, so their order by name is their order of creation. */
  const insertSupportingAssetsOf = async (primaryAssetId: string, count: number, role: SupportToPrimaryLinkRole = 'unknown'): Promise<Array<string>> => {
    const assetIds = Array.from({ length: count }, () => uuidv7());
    const linkIds = Array.from({ length: count }, () => uuidv7());
    await db.execute(sql`INSERT INTO supporting_assets (id, tenant_id, name, category_id)
      SELECT id, ${adminTenantId}, 'Bulk ' || lpad(n::text, 6, '0'), 'host' FROM unnest(${sql.param(assetIds)}::uuid[]) WITH ORDINALITY AS t(id, n)`);
    await db.execute(sql`INSERT INTO support_to_primary_links (id, tenant_id, supporting_asset_id, primary_asset_id, roles)
      SELECT id, ${adminTenantId}, supporting_asset_id, ${primaryAssetId}, ARRAY[${role}] FROM unnest(${sql.param(linkIds)}::uuid[], ${sql.param(assetIds)}::uuid[]) AS t(id, supporting_asset_id)`);
    return assetIds;
  };

  describe('derived supporting assets ranked by impact', () => {
    const primary = async (name: string) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name, description: null, ownerId: null, businessValueCategoryIds: [],
      });
      return id;
    };
    const asset = async (name: string) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      return id;
    };
    const supports = async (supportingAssetId: string, primaryAssetId: string, roles?: Array<SupportToPrimaryLinkRole>) =>
      services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId, primaryAssetId, roles,
      }]);
    const runs = async (providerAssetId: string, dependentAssetId: string) =>
      services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId, dependentAssetId,
      }]);
    const scenario = async (primaryAssetIds: Array<string>, outcomeId = attackOutcomeId) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Impact Scenario', description: null, attackOutcomeId: outcomeId, primaryAssetIds,
      });
      return id;
    };
    const ransomwareId = () => deriveSeedId(adminTenantId, AttackOutcome_Ransomware);

    /** The worked example of the impact reading: two primary assets, eight supporting assets. */
    const buildPaymentChain = async () => {
      const ctd = await primary('Card Transaction Data');
      const cp = await primary('Customer Portal');
      const cae = await asset('Card Authorization Engine');
      const cdb = await asset('Customer Database');
      const bkp = await asset('Backup Vault');
      const pbi = await asset('Power BI Workspace');
      const elb = await asset('Edge Load Balancer');
      const spl = await asset('Splunk SIEM');
      const aks = await asset('Kubernetes Platform (AKS)');
      const az = await asset('Azure Cloud Subscription');
      await supports(cae, ctd, ['processes', 'transmits']);
      await supports(cae, cp, ['processes', 'transmits']);
      await supports(cdb, ctd, ['stores']);
      await supports(bkp, ctd, ['stores', 'supports_availability']);
      await supports(pbi, ctd, ['reads']);
      await supports(elb, cp, ['supports_availability']);
      await supports(spl, ctd, ['monitors']);
      await runs(aks, cae);
      await runs(az, aks);
      const scenarioId = await scenario([ctd, cp], ransomwareId());
      return { scenarioId, ctd, cp, cae, cdb, bkp, pbi, elb, spl, aks, az };
    };

    it('should rank one row per supporting asset by its share of the scenario\'s loss', async () => {
      const { scenarioId } = await buildPaymentChain();

      const result = await services.withOrigin(adminOrigin).riskScenarios.getDerivedSupportingAssets(scenarioId);

      expect(result!.attackOutcome.criteriaReached).toEqual({
        availability: 'full', integrity: 'lower', confidentiality: 'full', traceability: 'none',
      });
      expect(result!.assets.map((row) => [row.supportingAssetName, wholePercent(row.impact)])).toEqual([
        ['Card Authorization Engine', 100],
        ['Backup Vault', 50],
        ['Customer Database', 50],
        ['Kubernetes Platform (AKS)', 50],
        ['Power BI Workspace', 35],
        ['Azure Cloud Subscription', 25],
        ['Edge Load Balancer', 20],
        ['Splunk SIEM', 10],
      ]);
    });

    it('should carry each row\'s depth, via, roles and best path per primary asset', async () => {
      const { scenarioId, ctd, cp, cae, aks } = await buildPaymentChain();

      const result = await services.withOrigin(adminOrigin).riskScenarios.getDerivedSupportingAssets(scenarioId);
      const row = (id: string) => result!.assets.find((entry) => entry.supportingAssetId === id)!;

      expect(row(cae)).toMatchObject({
        depth: 0,
        via: [{ id: ctd, name: 'Card Transaction Data' }, { id: cp, name: 'Customer Portal' }],
        roles: ['processes', 'transmits'],
      });
      expect(row(aks)).toMatchObject({ depth: 1, via: [{ id: cae, name: 'Card Authorization Engine' }], roles: [] });
      expect(row(aks).contributions).toEqual([ctd, cp].map((primaryAssetId) => expect.objectContaining({
        primaryAssetId,
        hops: 1,
        chain: [{ id: cae, name: 'Card Authorization Engine', derivedName: null }],
        roles: ['processes', 'transmits'],
        share: 1,
        contribution: 0.25,
      })));
    });

    it('should page the ranked assets in the order asked, counting the whole walk', async () => {
      const { scenarioId } = await buildPaymentChain();
      const scoped = services.withOrigin(adminOrigin).riskScenarios;
      const names = async (query: ScenarioPageQuery<ScenarioSupportingAssetSortKey>) =>
        (await scoped.listDerivedSupportingAssets(scenarioId, query))!.items.map((row) => row.supportingAssetName);

      const first = await scoped.listDerivedSupportingAssets(scenarioId, { page: 1, limit: 3, sortDesc: true });

      expect(first).toMatchObject({ total: 8, directCount: 6, transitiveCount: 2 });
      expect(first!.items).toEqual((await scoped.getDerivedSupportingAssets(scenarioId))!.assets.slice(0, 3));
      expect(await names({ page: 3, limit: 3, sortDesc: true })).toEqual(['Edge Load Balancer', 'Splunk SIEM']);
      expect(await names({ page: 1, limit: 3, sortBy: 'supportingAsset', sortDesc: false }))
        .toEqual(['Azure Cloud Subscription', 'Backup Vault', 'Card Authorization Engine']);
      expect(await names({ page: 1, limit: 2, sortBy: 'depth', sortDesc: true })).toEqual(['Azure Cloud Subscription', 'Kubernetes Platform (AKS)']);
    });

    it('should count the best path to a primary asset once, not every path to it', async () => {
      const pa = await primary('Ledger');
      const backup = await asset('Backup Server');
      const database = await asset('Ledger Database');
      await supports(backup, pa, ['stores']);
      await supports(database, pa, ['stores']);
      await runs(backup, database);

      const result = await services.withOrigin(adminOrigin).riskScenarios.getDerivedSupportingAssets(await scenario([pa], ransomwareId()));

      expect(result!.assets.find((row) => row.supportingAssetId === backup)).toMatchObject({ impact: 1, depth: 0 });
    });

    it('should flag an asset a closed scope does not map, and nothing in an open scope', async () => {
      const { scenarioId, az } = await buildPaymentChain();
      const scoped = services.withOrigin(adminOrigin);
      const outOfScope = async () => (await scoped.riskScenarios.getDerivedSupportingAssets(scenarioId))!.assets
        .filter((row) => row.outOfScope)
        .map((row) => row.supportingAssetId);

      expect(await outOfScope()).toEqual([]);

      const mapped = (await scoped.riskScenarios.getDerivedSupportingAssets(scenarioId))!.assets
        .map((row) => row.supportingAssetId)
        .filter((id) => id !== az);
      await scoped.organizations.updateOrganization(organizationId, { estateMode: 'closed', mapping: { added: mapped, removed: [] } });

      expect(await outOfScope()).toEqual([az]);
    });

    it('should read every impact unchanged after a CRQ run', async () => {
      const { scenarioId } = await buildPaymentChain();
      const scoped = services.withOrigin(adminOrigin);
      const before = await scoped.riskScenarios.getDerivedSupportingAssets(scenarioId);

      await db.insert(crqIndicatorRuns).values({
        id: uuidv7(), riskScenarioId: scenarioId, iterations: 1000, vulnerabilityP5: 0.1, vulnerabilityP50: 0.2,
        vulnerabilityP95: 0.3, lefMean: 2, aleMean: 2, aleP10: 1, aleP90: 3, techniqueCount: 10, coveredTechniqueCount: 4,
      });

      expect(await scoped.riskScenarios.getDerivedSupportingAssets(scenarioId)).toEqual(before);
    });

    it('should return no row for a scenario with no primary asset', async () => {
      const result = await services.withOrigin(adminOrigin).riskScenarios.getDerivedSupportingAssets(await scenario([]));

      expect(result).toMatchObject({ primaryAssets: [], assets: [] });
    });

    it('should terminate on a cycle and list each asset once', async () => {
      const pa = await primary('Cycle PA');
      const sa1 = await asset('Cycle SA1');
      const sa2 = await asset('Cycle SA2');
      await supports(sa1, pa);
      await runs(sa2, sa1);
      await runs(sa1, sa2);

      const result = await services.withOrigin(adminOrigin).riskScenarios.getDerivedSupportingAssets(await scenario([pa]));

      expect(result!.assets.map((row) => row.supportingAssetId).sort()).toEqual([sa1, sa2].sort());
    });

    it('should draw on the graph the impact the list reads, whatever depth the graph shows', async () => {
      const pa = await primary('Ledger');
      const siem = await asset('SIEM');
      const database = await asset('Ledger Database');
      await supports(siem, pa, ['monitors']);
      await supports(database, pa, ['stores']);
      await runs(siem, database);
      const scenarioId = await scenario([pa], ransomwareId());
      const scoped = services.withOrigin(adminOrigin);

      const list = await scoped.riskScenarios.getDerivedSupportingAssets(scenarioId);
      const graph = await scoped.riskScenarios.getDependencyGraph(scenarioId, 1);

      expect(list!.assets.find((row) => row.supportingAssetId === siem)!.impact).toBe(0.5);
      expect(graph.assets.find((node) => node.id === siem)!.impact).toBe(0.5);
      expect(graph.links.find((link) => link.providerId === siem && link.dependentId === pa)!.attackShare)
        .toEqual({ outcomeTotal: 2.5, transmittedTotal: 0.5, share: 0.2 });
      expect(graph.attackOutcome).toMatchObject({ name: 'Ransomware' });
    });
  });

  describe('dependency graph', () => {
    const primary = async (name: string) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name, description: null, ownerId: null, businessValueCategoryIds: [],
      });
      return id;
    };
    const asset = async (name: string) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      return id;
    };
    const supports = async (supportingAssetId: string, primaryAssetId: string) =>
      services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId, primaryAssetId,
      }]);
    const dependsOn = async (dependentAssetId: string, providerAssetId: string) =>
      services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId, dependentAssetId,
      }]);
    const scenario = async (primaryAssetIds: Array<string>) => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Graph Scenario', description: null, attackOutcomeId, primaryAssetIds,
      });
      return id;
    };

    it('should return the scenario primary assets and the chain below all of them', async () => {
      const ledger = await primary('Ledger');
      const payments = await primary('Payments');
      const app = await asset('srv-ledger-app');
      const gateway = await asset('payment-gateway');
      const cluster = await asset('esx-cluster');
      await supports(app, ledger);
      await supports(gateway, payments);
      await dependsOn(app, cluster);

      const graph = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(await scenario([ledger, payments]), 3);

      expect(graph.primaryAssets.map((a) => a.name).sort()).toEqual(['Ledger', 'Payments']);
      expect(graph.assets.map((a) => a.id).sort()).toEqual([app, gateway, cluster].sort());
      expect(graph.links).toContainEqual(expect.objectContaining({ dependentId: ledger, providerId: app }));
      expect(graph.links).toContainEqual(expect.objectContaining({ dependentId: payments, providerId: gateway }));
      expect(graph.links).toContainEqual(expect.objectContaining({ dependentId: app, providerId: cluster }));
    });

    it('should return a provider two primary assets share once, with a link from each', async () => {
      const ledger = await primary('Ledger');
      const payments = await primary('Payments');
      const store = await asset('db-core-prod');
      await supports(store, ledger);
      await supports(store, payments);

      const graph = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(await scenario([ledger, payments]), 3);

      expect(graph.assets.filter((a) => a.id === store)).toHaveLength(1);
      expect(graph.links.filter((link) => link.providerId === store).map((link) => link.dependentId).sort())
        .toEqual([ledger, payments].sort());
    });

    it('should expand a shared asset from its shortest distance to any primary asset', async () => {
      const ledger = await primary('Ledger');
      const payments = await primary('Payments');
      const app = await asset('srv-ledger-app');
      const store = await asset('db-core-prod');
      const san = await asset('stockage-san');
      await supports(app, ledger);
      await supports(store, payments);
      await dependsOn(app, store);
      await dependsOn(store, san);

      const graph = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(await scenario([ledger, payments]), 2);

      expect(graph.assets.map((a) => a.id).sort()).toEqual([app, store, san].sort());
      expect(graph.truncated).toEqual([]);
    });

    it('should return the primary asset graph when the scenario has one primary asset', async () => {
      const ledger = await primary('Ledger');
      const app = await asset('srv-ledger-app');
      const cluster = await asset('esx-cluster');
      await supports(app, ledger);
      await dependsOn(app, cluster);

      const scoped = services.withOrigin(adminOrigin);
      const { primaryAssets, attackOutcome: _attackOutcome, assets, links, ...graph } = await scoped.riskScenarios.getDependencyGraph(await scenario([ledger]), 1);

      expect(primaryAssets).toEqual([{ id: ledger, name: 'Ledger' }]);
      expect({
        ...graph,
        assets: assets.map(({ impact: _impact, contributions: _contributions, ...node }) => node),
        links: links.map(({ attackShare: _attackShare, ...link }) => link),
      }).toEqual(await scoped.assetDependencies.getPrimaryAssetDependencyGraph(ledger, 1));
    });

    it('should draw a primary asset\'s providers of highest impact first and fold the rest on it', async () => {
      const ledger = await primary('Ledger');
      await insertSupportingAssetsOf(ledger, DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET + 5, 'monitors');
      const store = await asset('Zulu Store');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: store, primaryAssetId: ledger, roles: ['stores'],
      }]);
      const scenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenarioId, organizationId, name: 'Wide Scenario', description: null,
        attackOutcomeId: deriveSeedId(adminTenantId, AttackOutcome_Ransomware), primaryAssetIds: [ledger],
      });

      const graph = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(scenarioId, 2);

      expect(graph.assets).toHaveLength(DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET);
      expect(graph.assets.map((node) => node.id)).toContain(store);
      expect(graph.truncated).toEqual([{ assetId: ledger, hiddenProviderCount: 6, foldedBy: 'width' }]);
      expect(graph.hiddenAssetCount).toBe(6);
      expect(graph.assets.find((node) => node.id === store)!.contributions).toMatchObject([{ primaryAssetId: ledger, primaryAssetName: 'Ledger' }]);
    });

    it('should draw the link to a provider folded on one asset once a deeper level draws it', async () => {
      const ledger = await primary('Ledger');
      const [first] = await insertSupportingAssetsOf(ledger, DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET);
      const late = await asset('Zz Late');
      await supports(late, ledger);
      await dependsOn(first, late);

      const graph = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(await scenario([ledger]), 2);

      expect(graph.assets.map((node) => node.id)).toContain(late);
      expect(graph.links.filter((link) => link.providerId === late).map((link) => link.dependentId).sort()).toEqual([first, ledger].sort());
      expect(graph.truncated).toEqual([]);
    });

    it('should draw a primary asset\'s most critical providers first on its own graph', async () => {
      const ledger = await primary('Ledger');
      await insertSupportingAssetsOf(ledger, DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET + 5);
      const critical = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: critical, name: 'Zulu Vault', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host', criticality: 'very_high',
      });
      await supports(critical, ledger);

      const graph = await services.withOrigin(adminOrigin).assetDependencies.getPrimaryAssetDependencyGraph(ledger, 1);

      expect(graph.assets.map((node) => node.id)).toContain(critical);
      expect(graph.truncated).toEqual([{ assetId: ledger, hiddenProviderCount: 6, foldedBy: 'width' }]);
    });

    it('should share the graph\'s budget among the primary assets and fold what each cannot draw', async () => {
      const primaryCount = Math.ceil(DEPENDENCY_GRAPH_MAX_ASSETS / DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET) + 1;
      const primaryIds: Array<string> = [];
      for (let index = 0; index < primaryCount; index += 1) {
        const primaryAssetId = await primary(`Primary ${index}`);
        await insertSupportingAssetsOf(primaryAssetId, DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET);
        primaryIds.push(primaryAssetId);
      }

      const graph = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(await scenario(primaryIds), 1);

      expect(graph.assets).toHaveLength(DEPENDENCY_GRAPH_MAX_ASSETS);
      expect(graph.truncated.reduce((sum, fold) => sum + fold.hiddenProviderCount, 0))
        .toBe(primaryCount * DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET - DEPENDENCY_GRAPH_MAX_ASSETS);
      expect(graph.hiddenAssetCount).toBe(primaryCount * DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET - DEPENDENCY_GRAPH_MAX_ASSETS);
      const drawnUnder = (primaryAssetId: string) => graph.links.filter((link) => link.dependentId === primaryAssetId).length;
      expect(Math.min(...primaryIds.map(drawnUnder))).toBe(Math.floor(DEPENDENCY_GRAPH_MAX_ASSETS / primaryCount));
    });

    it('should return no primary asset and an empty graph for a scenario without one', async () => {
      const { attackOutcome: _attackOutcome, ...graph } = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(await scenario([]), 3);

      expect(graph).toEqual({ primaryAssets: [], assets: [], links: [], truncated: [], hiddenAssetCount: 0 });
    });
  });

  describe('an asset with no name, known by its derived name', () => {
    let primaryAssetId: string;
    let addressAssetId: string;
    let providerAssetId: string;
    let scenarioId: string;

    const insertAsset = async (name: string | null, derivedName: string | null) => {
      const id = uuidv7();
      await db.insert(supportingAssets).values({
        id, tenantId: adminTenantId, name, derivedName, exposure: 'unknown', categoryId: 'host', criticality: 'unknown',
      });
      return id;
    };

    beforeEach(async () => {
      primaryAssetId = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id: primaryAssetId, organizationId, name: 'Ledger', description: null, ownerId: null, businessValueCategoryIds: [],
      });
      // Same links and roles, so the two tie on impact and only the name they display orders them.
      const namedAssetId = await insertAsset('05 early host', null);
      addressAssetId = await insertAsset(null, '10.0.0.1');
      providerAssetId = await insertAsset(null, '10.0.0.2');
      const links = services.withOrigin(adminOrigin).assetDependencies;
      await links.createSupportToPrimaryLinks([namedAssetId, addressAssetId].map((supportingAssetId) => ({
        id: uuidv7(), supportingAssetId, primaryAssetId, roles: ['stores' as const],
      })));
      await links.createSupportToSupportLinks([{ id: uuidv7(), providerAssetId, dependentAssetId: addressAssetId }]);
      scenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenarioId, organizationId, name: 'Nameless Scenario', description: null, attackOutcomeId, primaryAssetIds: [primaryAssetId],
      });
    });

    it('should carry its derived name on the ranked rows, the way in and the chain, and sort by the name it displays', async () => {
      const result = await services.withOrigin(adminOrigin).riskScenarios.getDerivedSupportingAssets(scenarioId);

      const rows = result!.assets;
      expect(rows.map((row) => [row.supportingAssetName, row.supportingAssetDerivedName])).toEqual([
        ['05 early host', null],
        [null, '10.0.0.1'],
        [null, '10.0.0.2'],
      ]);
      const provider = rows.find((row) => row.supportingAssetId === providerAssetId)!;
      expect(provider.via).toEqual([{ id: addressAssetId, name: null, derivedName: '10.0.0.1' }]);
      expect(provider.contributions[0].chain).toContainEqual({ id: addressAssetId, name: null, derivedName: '10.0.0.1' });
      const direct = rows.find((row) => row.supportingAssetId === addressAssetId)!;
      expect(direct.via).toEqual([{ id: primaryAssetId, name: 'Ledger', derivedName: null }]);
    });

    it('should carry its derived name on the dependency graph nodes', async () => {
      const graph = await services.withOrigin(adminOrigin).riskScenarios.getDependencyGraph(scenarioId, 3);

      expect(graph.assets.find((asset) => asset.id === providerAssetId)).toMatchObject({ name: null, derivedName: '10.0.0.2' });
    });

    it('should carry its derived name on a finding and on the way in, null for a primary asset', async () => {
      const flaw = uuidv7();
      await db.insert(cve).values([{ id: flaw, tenantId: adminTenantId, cveId: 'CVE-2026-0900' }]);
      for (const supportingAssetId of [addressAssetId, providerAssetId]) {
        await services.withOrigin(adminOrigin).supportingAssets.createEvidence({ id: uuidv7(), supportingAssetId, cveId: flaw, userId: adminUserId });
      }

      const findings = await findingsOf(adminOrigin, scenarioId);

      const on = (id: string) => findings.find((finding) => finding.supportingAssetId === id)!;
      expect(on(addressAssetId)).toMatchObject({ supportingAssetName: null, supportingAssetDerivedName: '10.0.0.1' });
      expect(on(addressAssetId).firstPath).toEqual({ viaAssetId: primaryAssetId, viaAssetName: 'Ledger', viaAssetDerivedName: null, depth: 0 });
      expect(on(providerAssetId).firstPath).toEqual({ viaAssetId: addressAssetId, viaAssetName: null, viaAssetDerivedName: '10.0.0.1', depth: 1 });
    });
  });

  describe('findings for risk scenario', () => {
    const insertCve = async (
      cveTextId: string,
      metadata: { cvss?: number, epss?: number, kev?: boolean, kevUpdatedAt?: Date | null } = {},
    ): Promise<string> => {
      const id = uuidv7();
      await db.insert(cve).values([{
        id,
        tenantId: adminTenantId,
        cveId: cveTextId,
        cvss: metadata.cvss ?? null,
        epss: metadata.epss ?? null,
        kev: metadata.kev ?? null,
        kevUpdatedAt: metadata.kevUpdatedAt === undefined ? (metadata.kev ? new Date() : null) : metadata.kevUpdatedAt,
      }]);
      return id;
    };

    const createScenario = async (primaryAssetIds: Array<string>): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id, organizationId, name: 'Findings Scenario', description: null,
        attackOutcomeId, primaryAssetIds,
      });
      return id;
    };

    const createPrimaryAsset = async (name: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
        id, organizationId, name, description: null, ownerId: null, businessValueCategoryIds: [],
      });
      return id;
    };

    const createSupportingAsset = async (name: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      return id;
    };

    const attachEvidence = async (supportingAssetId: string, cveUuid: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id, supportingAssetId, cveId: cveUuid, userId: adminUserId,
      });
      return id;
    };

    it('should return empty for a scenario without primary assets', async () => {
      const scenarioId = await createScenario([]);
      const findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings).toHaveLength(0);
    });

    it('should return findings on direct supporting assets with CVE metadata and path', async () => {
      const paId = await createPrimaryAsset('PA Direct');
      const saId = await createSupportingAsset('SA With Finding');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId,
      }]);
      const cveUuid = await insertCve('CVE-2021-44228', { cvss: 9.8, epss: 0.97, kev: true });
      await attachEvidence(saId, cveUuid);
      const scenarioId = await createScenario([paId]);

      const findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings).toHaveLength(1);
      expect(findings[0].cveId).toBe('CVE-2021-44228');
      expect(findings[0].cvss).toBe(9.8);
      expect(findings[0].epss).toBe(0.97);
      expect(findings[0].kev).toBe(true);
      expect(findings[0].currentState).toBe('applicable');
      expect(findings[0].supportingAssetName).toBe('SA With Finding');
      expect(findings[0]).toMatchObject({ firstPath: { viaAssetId: paId, viaAssetName: 'PA Direct', viaAssetDerivedName: null, depth: 0 }, pathCount: 1 });
    });

    it('should flag a finding as KEV only when CISA dated the CVE, not for a connector flag', async () => {
      const paId = await createPrimaryAsset('PA Kev');
      const saId = await createSupportingAsset('SA Kev');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId,
      }]);
      await attachEvidence(saId, await insertCve('CVE-2026-7001', { cvss: 9.0, kev: true, kevUpdatedAt: null }));
      await attachEvidence(saId, await insertCve('CVE-2026-7002', { cvss: 9.0, kevUpdatedAt: new Date('2026-01-01T00:00:00Z') }));
      const scenarioId = await createScenario([paId]);

      const findings = await findingsOf(adminOrigin, scenarioId);

      const kevOf = (cveId: string) => findings.find((finding) => finding.cveId === cveId)?.kev;
      expect(kevOf('CVE-2026-7001')).toBe(false);
      expect(kevOf('CVE-2026-7002')).toBe(true);
    });

    it('should include findings on transitive supporting assets and skip assets without evidence', async () => {
      const paId = await createPrimaryAsset('PA Chain');
      const directId = await createSupportingAsset('SA Direct No Finding');
      const providerId = await createSupportingAsset('SA Provider With Finding');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: directId, primaryAssetId: paId,
      }]);
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
        id: uuidv7(), providerAssetId: providerId, dependentAssetId: directId,
      }]);
      const cveUuid = await insertCve('CVE-2023-4966');
      await attachEvidence(providerId, cveUuid);
      const scenarioId = await createScenario([paId]);

      const findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings).toHaveLength(1);
      expect(findings[0].supportingAssetId).toBe(providerId);
      expect(findings[0]).toMatchObject({ firstPath: { viaAssetId: directId, viaAssetName: 'SA Direct No Finding', viaAssetDerivedName: null, depth: 1 }, pathCount: 1 });
    });

    it('should surface dismissed state with reason and flip back on re-mark', async () => {
      const paId = await createPrimaryAsset('PA Dismiss');
      const saId = await createSupportingAsset('SA Dismiss');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId,
      }]);
      const cveUuid = await insertCve('CVE-2020-1472');
      const evidenceId = await attachEvidence(saId, cveUuid);
      const scenarioId = await createScenario([paId]);

      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Patched last week',
        changedByUserId: adminUserId,
      });

      let findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings[0].currentState).toBe('dismissed');
      expect(findings[0].stateReason).toBe('Patched last week');

      await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({
        evidenceId, changedByUserId: adminUserId,
      });

      findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings[0].currentState).toBe('applicable');
    });

    it('should fold multi-primary-asset reachability into one row with two paths', async () => {
      const pa1Id = await createPrimaryAsset('PA Fold 1');
      const pa2Id = await createPrimaryAsset('PA Fold 2');
      const saId = await createSupportingAsset('SA Shared');
      // Linked against the ids' order: the way in a finding names is the smallest id, not the oldest link.
      for (const primaryAssetId of [pa2Id, pa1Id]) {
        await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
          id: uuidv7(), supportingAssetId: saId, primaryAssetId,
        }]);
      }
      const cveUuid = await insertCve('CVE-2024-3400');
      await attachEvidence(saId, cveUuid);
      const scenarioId = await createScenario([pa1Id, pa2Id]);

      const findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings).toHaveLength(1);
      expect(findings[0].pathCount).toBe(2);
      expect(findings[0].firstPath?.viaAssetName).toBe('PA Fold 1');
    });

    it('should report every transitive route to a shared supporting asset', async () => {
      const paId = await createPrimaryAsset('PA Multi Route');
      const appAId = await createSupportingAsset('App A');
      const appBId = await createSupportingAsset('App B');
      const sharedId = await createSupportingAsset('Shared Postgres');
      for (const dependentAssetId of [appBId, appAId]) {
        await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
          id: uuidv7(), supportingAssetId: dependentAssetId, primaryAssetId: paId,
        }]);
        await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
          id: uuidv7(), providerAssetId: sharedId, dependentAssetId,
        }]);
      }
      const cveUuid = await insertCve('CVE-2022-22965', { cvss: 9.8 });
      await attachEvidence(sharedId, cveUuid);
      const scenarioId = await createScenario([paId]);

      const findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings).toHaveLength(1);
      expect(findings[0].supportingAssetId).toBe(sharedId);
      expect(findings[0].pathCount).toBe(2);
      expect(findings[0].firstPath).toMatchObject({ depth: 1 });
      expect(findings[0].firstPath?.viaAssetName).toBe('App A');
    });

    it('should count only the dependents the scenario first reaches one level above a provider', async () => {
      const paId = await createPrimaryAsset('PA Counted');
      const otherPaId = await createPrimaryAsset('PA Elsewhere');
      const [firstId, secondId, deeperId, outsideId, sharedId] = [
        await createSupportingAsset('App First'),
        await createSupportingAsset('App Second'),
        await createSupportingAsset('Deeper Dependent'),
        await createSupportingAsset('Outside Dependent'),
        await createSupportingAsset('Shared Provider'),
      ];
      const links = services.withOrigin(adminOrigin).assetDependencies;
      await links.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId: secondId, primaryAssetId: paId },
        { id: uuidv7(), supportingAssetId: firstId, primaryAssetId: paId },
        { id: uuidv7(), supportingAssetId: outsideId, primaryAssetId: otherPaId },
      ]);
      // The provider sits at depth 1 through the two direct apps; the deeper dependent, itself at
      // depth 1 below the first app, is no way in to it, nor is the dependent outside the scenario.
      await links.createSupportToSupportLinks([
        { id: uuidv7(), providerAssetId: sharedId, dependentAssetId: firstId },
        { id: uuidv7(), providerAssetId: sharedId, dependentAssetId: secondId },
        { id: uuidv7(), providerAssetId: deeperId, dependentAssetId: firstId },
        { id: uuidv7(), providerAssetId: sharedId, dependentAssetId: deeperId },
        { id: uuidv7(), providerAssetId: sharedId, dependentAssetId: outsideId },
      ]);
      await attachEvidence(sharedId, await insertCve('CVE-2021-26855', { cvss: 9.8 }));
      const scenarioId = await createScenario([paId]);

      const findings = await findingsOf(adminOrigin, scenarioId);

      expect(findings.map((row) => row.supportingAssetId)).toEqual([sharedId]);
      expect(findings[0]).toMatchObject({
        pathCount: 2,
        firstPath: { viaAssetId: firstId, viaAssetName: 'App First', depth: 1 },
      });
    });

    it('should read the reach of the scenario\'s primary assets alone, at the shortest depth among them', async () => {
      const [paOneId, paTwoId, outsidePaId] = [
        await createPrimaryAsset('PA One'),
        await createPrimaryAsset('PA Two'),
        await createPrimaryAsset('PA Outside'),
      ];
      const [bothWaysId, outsideDirectId, outsideOnlyId, viaTwoId, middleId] = [
        await createSupportingAsset('Both Ways'),
        await createSupportingAsset('Outside Direct'),
        await createSupportingAsset('Outside Only'),
        await createSupportingAsset('Via Two'),
        await createSupportingAsset('Middle'),
      ];
      const links = services.withOrigin(adminOrigin).assetDependencies;
      await links.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId: bothWaysId, primaryAssetId: paOneId },
        { id: uuidv7(), supportingAssetId: bothWaysId, primaryAssetId: outsidePaId },
        { id: uuidv7(), supportingAssetId: outsideDirectId, primaryAssetId: outsidePaId },
        { id: uuidv7(), supportingAssetId: outsideOnlyId, primaryAssetId: outsidePaId },
        { id: uuidv7(), supportingAssetId: viaTwoId, primaryAssetId: paTwoId },
      ]);
      // Both Ways sits at depth 0 under PA One and at depth 2 under PA Two; Outside Direct sits at
      // depth 0 under the outside primary asset alone, and at depth 1 below Both Ways in the scenario.
      await links.createSupportToSupportLinks([
        { id: uuidv7(), providerAssetId: middleId, dependentAssetId: viaTwoId },
        { id: uuidv7(), providerAssetId: bothWaysId, dependentAssetId: middleId },
        { id: uuidv7(), providerAssetId: outsideDirectId, dependentAssetId: bothWaysId },
      ]);
      await attachEvidence(bothWaysId, await insertCve('CVE-2026-7101'));
      await attachEvidence(outsideDirectId, await insertCve('CVE-2026-7102'));
      await attachEvidence(outsideOnlyId, await insertCve('CVE-2026-7103'));
      const scenarioId = await createScenario([paOneId, paTwoId]);

      const findings = await findingsOf(adminOrigin, scenarioId);
      const on = (assetId: string) => findings.find((row) => row.supportingAssetId === assetId);

      expect(findings.map((row) => row.supportingAssetId).toSorted()).toEqual([bothWaysId, outsideDirectId].toSorted());
      expect(on(bothWaysId)).toMatchObject({ firstPath: { viaAssetId: paOneId, viaAssetName: 'PA One', depth: 0 }, pathCount: 1 });
      expect(on(outsideDirectId)).toMatchObject({ firstPath: { viaAssetId: bothWaysId, viaAssetName: 'Both Ways', depth: 1 }, pathCount: 1 });
    });

    it('should collapse the same CVE attached twice to one asset by different provenance', async () => {
      const paId = await createPrimaryAsset('PA Duplicate');
      const saId = await createSupportingAsset('SA Duplicate');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId,
      }]);
      const cveUuid = await insertCve('CVE-2021-34527', { cvss: 8.8 });
      await attachEvidence(saId, cveUuid);
      await db.insert(assetEvidence).values([{
        id: uuidv7(),
        tenantId: adminTenantId,
        supportingAssetId: saId,
        cveId: cveUuid,
        userId: adminUserId,
        sourceScenarioId: 'scenario-duplicate-2',
      }]);
      const scenarioId = await createScenario([paId]);

      const findings = await findingsOf(adminOrigin, scenarioId);
      expect(findings).toHaveLength(1);
      expect(findings[0].cveId).toBe('CVE-2021-34527');

      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: findings[0].id,
        dismissalType: 'false_positive',
        reasonCode: 'detection_error',
        reason: 'Duplicate handled',
        changedByUserId: adminUserId,
      });

      const afterDismiss = await findingsOf(adminOrigin, scenarioId);
      expect(afterDismiss).toHaveLength(1);
      expect(afterDismiss[0].currentState).toBe('dismissed');
      expect(afterDismiss[0].id).toBe(findings[0].id);
    });

    it('should keep, of two sources of one CVE on an asset, the one whose state changed last', async () => {
      const paId = await createPrimaryAsset('PA Recency');
      const saId = await createSupportingAsset('SA Recency');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId,
      }]);
      const cveUuid = await insertCve('CVE-2021-40444', { cvss: 8.8 });
      const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
      const dismissedLater = uuidv7();
      await db.insert(assetEvidence).values([
        { id: dismissedLater, tenantId: adminTenantId, supportingAssetId: saId, cveId: cveUuid, userId: adminUserId, createdAt: daysAgo(10) },
        {
          id: uuidv7(), tenantId: adminTenantId, supportingAssetId: saId, cveId: cveUuid, userId: adminUserId,
          sourceScenarioId: 'scenario-recency-2', createdAt: daysAgo(5),
        },
      ]);
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: dismissedLater, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Handled', changedByUserId: adminUserId,
      });
      const scenarioId = await createScenario([paId]);

      const findings = await findingsOf(adminOrigin, scenarioId);

      expect(findings.map((finding) => [finding.id, finding.currentState])).toEqual([[dismissedLater, 'dismissed']]);
    });

    it('should page the findings, filtered and ordered in the database, and count every page', async () => {
      const paId = await createPrimaryAsset('PA Paged');
      const alpha = await createSupportingAsset('Alpha host');
      const beta = await createSupportingAsset('Beta host');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId: alpha, primaryAssetId: paId },
        { id: uuidv7(), supportingAssetId: beta, primaryAssetId: paId },
      ]);
      const critical = await attachEvidence(alpha, await insertCve('CVE-2024-0001'));
      const low = await attachEvidence(alpha, await insertCve('CVE-2024-0002'));
      await attachEvidence(beta, await insertCve('CVE-2024-0003'));
      await db.insert(findingScores).values([critical, low].map((assetEvidenceId, index) => ({
        assetEvidenceId,
        tenantId: adminTenantId,
        score: index === 0 ? SEVERITY_BAND_MINIMUMS.critical : SEVERITY_BAND_MINIMUMS.low,
        band: index === 0 ? 'critical' as const : 'low' as const,
      })));
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: low, dismissalType: 'risk_accepted', reasonCode: 'wont_fix', reason: 'Accepted', changedByUserId: adminUserId,
      });
      const scenarioId = await createScenario([paId]);
      await recomputePrimaryAssetReach(services, adminTenantId);
      const list = (query: Partial<ScenarioFindingsQuery>) => services.withOrigin(adminOrigin).riskScenarios
        .listFindingsForRiskScenario(scenarioId, { page: 1, limit: 50, sortDesc: true, state: 'all', severity: 'all', ...query });
      const cveIds = async (query: Partial<ScenarioFindingsQuery>) => (await list(query)).items.map((row) => row.cveId);

      const all = await list({});
      expect(all.items.map((row) => row.cveId)).toEqual(['CVE-2024-0001', 'CVE-2024-0002', 'CVE-2024-0003']);
      expect(all.summary).toEqual({ critical: 1, high: 0, medium: 0, low: 1, unscored: 1, dismissed: 1, total: 3, unfiltered: 3 });
      expect(all.items[0]).toMatchObject({ supportingAssetName: 'Alpha host', firstPath: { viaAssetId: paId, depth: 0 }, pathCount: 1 });

      expect(await cveIds({ state: 'applicable' })).toEqual(['CVE-2024-0001', 'CVE-2024-0003']);
      expect((await list({ state: 'applicable' })).summary).toMatchObject({ total: 2, dismissed: 0, unfiltered: 3 });
      expect(await cveIds({ severity: 'unscored' })).toEqual(['CVE-2024-0003']);
      expect(await cveIds({ state: 'dismissed', severity: 'low' })).toEqual(['CVE-2024-0002']);
      expect(await cveIds({ page: 2, limit: 1, sortBy: 'name', sortDesc: false })).toEqual(['CVE-2024-0002']);
      expect(await cveIds({ sortBy: 'assetName', sortDesc: true })).toEqual(['CVE-2024-0003', 'CVE-2024-0001', 'CVE-2024-0002']);
      expect(await cveIds({ sortBy: 'ageDays', sortDesc: false })).toEqual(['CVE-2024-0002', 'CVE-2024-0001', 'CVE-2024-0003']);
    });

    it('should order the findings by asset name with case and accents folded together, in both directions', async () => {
      const paId = await createPrimaryAsset('PA Accented');
      const flaw = await insertCve('CVE-2024-2001');
      for (const name of ['Zèbre', 'école', 'eden', 'Ecole', 'abc']) {
        const assetId = await createSupportingAsset(name);
        await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: assetId, primaryAssetId: paId }]);
        await attachEvidence(assetId, flaw);
      }
      const scenarioId = await createScenario([paId]);
      await recomputePrimaryAssetReach(services, adminTenantId);
      const assetNames = async (sortDesc: boolean) => (await services.withOrigin(adminOrigin).riskScenarios
        .listFindingsForRiskScenario(scenarioId, { page: 1, limit: 50, sortBy: 'assetName', sortDesc, state: 'all', severity: 'all' })).items.map((row) => row.supportingAssetName);

      expect(await assetNames(false)).toEqual(['abc', 'Ecole', 'école', 'eden', 'Zèbre']);
      expect(await assetNames(true)).toEqual(['Zèbre', 'eden', 'école', 'Ecole', 'abc']);
    });

    it('should sum the applicable findings by CVSS severity and put the known exploited first', async () => {
      const paId = await createPrimaryAsset('PA Summary');
      const saId = await createSupportingAsset('SA Summary');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId }]);
      await attachEvidence(saId, await insertCve('CVE-2024-1001', { cvss: 9.8 }));
      await attachEvidence(saId, await insertCve('CVE-2024-1002', { cvss: 5.0, kev: true }));
      await attachEvidence(saId, await insertCve('CVE-2024-1003'));
      const dismissed = await attachEvidence(saId, await insertCve('CVE-2024-1004', { cvss: 7.5 }));
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: dismissed, dismissalType: 'risk_accepted', reasonCode: 'wont_fix', reason: 'Accepted', changedByUserId: adminUserId,
      });

      const scenarioId = await createScenario([paId]);
      await recomputePrimaryAssetReach(services, adminTenantId);
      const { counts, top } = await services.withOrigin(adminOrigin).riskScenarios.getFindingsSummaryForRiskScenario(scenarioId, 2);

      expect(counts).toEqual({ critical: 1, high: 0, medium: 1, low: 0, none: 0, unscored: 1, kev: 1, dismissed: 1, total: 4 });
      expect(top.map((row) => row.cveId)).toEqual(['CVE-2024-1002', 'CVE-2024-1001']);
    });

    it('should not return findings for another tenant scenario', async () => {
      const paId = await createPrimaryAsset('PA Isolated');
      const saId = await createSupportingAsset('SA Isolated');
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
        id: uuidv7(), supportingAssetId: saId, primaryAssetId: paId,
      }]);
      const cveUuid = await insertCve('CVE-2019-19781');
      await attachEvidence(saId, cveUuid);
      const scenarioId = await createScenario([paId]);

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const findings = await findingsOf(tenantBOrigin, scenarioId);
      expect(findings).toHaveLength(0);
    });
  });
});
