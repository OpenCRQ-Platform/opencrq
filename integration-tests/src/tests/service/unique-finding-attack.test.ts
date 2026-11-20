import type { AssetCategory, EventOrigin, IntegrationSource, SupportingAssetExposure } from '@app/module';
import {
  assetEvidence,
  assetEvidenceHistory,
  assetEvidenceSources,
  cve,
  cveTechniqueMapping,
  cveTechniqueResolution,
  findingScores,
  mitreTechniques,
  resolveSeverityBand,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const NETWORK_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
const RULE_CVE = 'CVE-2026-7100';
const CURATED_CVE = 'CVE-2026-7200';

describe('A unique CVE finding\'s techniques', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let userId: string;
  let connectorId: string;

  const createAsset = async (origin: EventOrigin, exposure: SupportingAssetExposure, categoryId: AssetCategory): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id, name: `${exposure}-${categoryId}-${id.slice(-6)}`, description: null, ownerId: null, exposure, categoryId,
    });
    return id;
  };

  const insertCve = async (cveId: string, owner: { tenantId: string }, cvssVector: string | null = NETWORK_VECTOR): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{ id, tenantId: owner.tenantId, cveId, cveTitle: `${cveId} title`, cvssVector }]);
    return id;
  };

  const curate = async (cveRef: string, owner: { tenantId: string }, externalId: string): Promise<void> => {
    const [technique] = await db.select({ id: mitreTechniques.id }).from(mitreTechniques).where(eq(mitreTechniques.externalId, externalId));
    const resolutionId = uuidv7();
    await db.insert(cveTechniqueResolution).values([{
      id: resolutionId, tenantId: owner.tenantId, cveId: cveRef, state: 'resolved', tablesVersion: 'test', resolvedAt: new Date(),
    }]);
    await db.insert(cveTechniqueMapping).values([{
      id: uuidv7(), tenantId: owner.tenantId, resolutionId, cveId: cveRef, mitreTechniqueId: technique.id,
      role: 'exploitation_technique', lane: 'curated', grain: 'parent', tablesVersion: 'test',
    }]);
  };

  const finding = async (
    supportingAssetId: string,
    cveRef: string,
    options: { state?: 'applicable' | 'dismissed', tenantId?: string, connectorId?: string } = {},
  ): Promise<string> => {
    const id = uuidv7();
    const owner = options.tenantId ?? tenantId;
    await db.insert(assetEvidence).values([{ id, supportingAssetId, tenantId: owner, cveId: cveRef, userId }]);
    await db.insert(findingScores).values([{
      assetEvidenceId: id, tenantId: owner, score: 60, band: resolveSeverityBand(60),
    }]);
    if (options.state === 'dismissed') {
      const dismissedAt = new Date();
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), tenantId, assetEvidenceId: id, stateChangedAt: dismissedAt, observedAt: dismissedAt, state: 'dismissed', origin: 'not_exposed',
      }]);
    }
    if (options.connectorId !== undefined) {
      await db.insert(assetEvidenceSources).values([{
        id: uuidv7(), tenantId, assetEvidenceId: id, connectorId: options.connectorId, sourceFindingId: `finding-${id}`, evaluatedAt: new Date(),
      }]);
    }
    return id;
  };

  const createConnector = async (source: IntegrationSource): Promise<string> => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: `${source} bot` });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration(source, serviceAccountId);
    return (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId(source))!;
  };

  const attackOf = (cveId: string, mappedToOrganizationId: string | null = null, origin: EventOrigin = adminOrigin) =>
    services.withOrigin(origin).findingScore.getUniqueCveFindingAttack({ cveId, mappedToOrganizationId });

  const countsOf = (attack: Awaited<ReturnType<typeof attackOf>>) =>
    Object.fromEntries((attack?.rows ?? []).map((row) => [`${row.externalId}/${row.group}`, row.assetCount]));

  const listedAssets = async (
    params: { cveId: string, technique: string | null, source?: IntegrationSource | null, mappedToOrganizationId?: string | null },
    origin: EventOrigin = adminOrigin,
  ): Promise<Array<string>> => {
    const page = await services.withOrigin(origin).findingScore.listScoredFindings({
      page: 1,
      limit: 100,
      state: 'applicable',
      source: params.source ?? null,
      vulnerability: { kind: 'cve', cveId: params.cveId },
      technique: params.technique,
      mappedToOrganizationId: params.mappedToOrganizationId ?? null,
      sortBy: 'score',
      sortDesc: true,
    });
    return page.items.map((item) => item.supportingAssetId).toSorted();
  };

  /** Two internet-facing hosts, three internal ones, one of unknown exposure, and an internal identity. */
  let assets: { internetFacing: Array<string>, internal: Array<string>, unknown: string, identity: string };
  let ruleCveRef: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    userId = setup.userId;
    connectorId = await createConnector('microsoft_graph');
    assets = {
      internetFacing: [await createAsset(adminOrigin, 'internet_facing', 'host'), await createAsset(adminOrigin, 'internet_facing', 'host')],
      internal: [
        await createAsset(adminOrigin, 'internal', 'host'),
        await createAsset(adminOrigin, 'internal', 'host'),
        await createAsset(adminOrigin, 'internal', 'host'),
      ],
      unknown: await createAsset(adminOrigin, 'unknown', 'host'),
      identity: await createAsset(adminOrigin, 'internal', 'identity'),
    };
    ruleCveRef = await insertCve(RULE_CVE, { tenantId });
    for (const assetId of [...assets.internetFacing, ...assets.internal, assets.unknown]) {
      await finding(assetId, ruleCveRef, { connectorId: assetId === assets.unknown ? undefined : connectorId });
    }
  });

  describe('the union with its asset counts', () => {
    it.each([
      ['internal', { 'T1190/exploitation': 2, 'T1210/exploitation': 4 }, ['internet_facing']],
      ['internet_facing', { 'T1190/exploitation': 3, 'T1210/exploitation': 3 }, ['internet_facing', 'unknown']],
    ] as const)('should count the unknown asset under the technique of the exposure it counts as, here %s', async (counted, counts, t1190Exposures) => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: counted });

      const attack = await attackOf(RULE_CVE);

      expect(attack?.assetCount).toBe(6);
      expect(countsOf(attack)).toEqual(counts);
      expect(attack?.rows.find((row) => row.externalId === 'T1190')?.exposures).toEqual(t1190Exposures);
    });

    it('should count a curated technique on every asset of the group', async () => {
      const curatedRef = await insertCve(CURATED_CVE, { tenantId });
      await curate(curatedRef, { tenantId }, 'T1133');
      for (const assetId of [assets.internetFacing[0], assets.internal[0], assets.unknown]) {
        await finding(assetId, curatedRef);
      }

      const attack = await attackOf(CURATED_CVE);

      expect(attack?.assetCount).toBe(3);
      expect(countsOf(attack)).toEqual({ 'T1133/exploitation': 3 });
      expect(attack?.rows[0]?.justification).toEqual({ kind: 'curated' });
    });

    it('should say on how many assets of a family a way in is set aside', async () => {
      await finding(assets.identity, ruleCveRef);

      const t1210 = (await attackOf(RULE_CVE))?.rows.find((row) => row.externalId === 'T1210');

      expect(t1210).toMatchObject({ assetCount: 4, setAside: [{ categoryId: 'identity', assetCount: 1 }] });
    });

    it('should leave dismissed findings out and answer an empty union when all are dismissed', async () => {
      const dismissedRef = await insertCve('CVE-2026-7300', { tenantId });
      await finding(assets.internal[0], dismissedRef, { state: 'dismissed' });

      const attack = await attackOf('CVE-2026-7300');

      expect(attack).toMatchObject({ assetCount: 0, rows: [] });
      expect(attack?.waysIn.map((wayIn) => wayIn.externalId).toSorted()).toEqual(['T1190', 'T1210']);
    });

    it('should answer nothing for a CVE the tenant does not have', async () => {
      expect(await attackOf('CVE-2026-7999')).toBeUndefined();
    });

    it('should count the mapped assets only under a closed organization', async () => {
      const organizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: organizationId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assets.internetFacing[0], assets.internal[0]] },
      ]);

      const attack = await attackOf(RULE_CVE, organizationId);

      expect(attack?.assetCount).toBe(2);
      expect(countsOf(attack)).toEqual({ 'T1190/exploitation': 1, 'T1210/exploitation': 1 });
    });
  });

  describe('the technique filter of the findings list', () => {
    it('should list exactly the assets a count names', async () => {
      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1190' })).toEqual(assets.internetFacing.toSorted());
      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1210' })).toEqual([...assets.internal, assets.unknown].toSorted());
    });

    it('should list the unknown asset under the technique of the exposure the tenant counts it as', async () => {
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });

      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1190' })).toEqual([...assets.internetFacing, assets.unknown].toSorted());
      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1210' })).toEqual(assets.internal.toSorted());
    });

    it('should leave out the assets whose family sets the way in aside', async () => {
      await finding(assets.identity, ruleCveRef);

      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1210' })).toEqual([...assets.internal, assets.unknown].toSorted());
    });

    it('should match nothing for a technique the CVE does not open', async () => {
      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1133' })).toEqual([]);
    });

    it('should combine with the source filter and the organization scope', async () => {
      const organizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: organizationId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assets.internetFacing[0], assets.unknown] },
      ]);

      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1190', source: 'microsoft_graph' })).toEqual(assets.internetFacing.toSorted());
      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1210', mappedToOrganizationId: organizationId })).toEqual([assets.unknown]);
    });
  });

  describe('tenant isolation', () => {
    it('should never count nor list another tenant\'s findings of the same CVE', async () => {
      const otherTenantId = await createTenant(services, userId);
      const otherOrigin: EventOrigin = { type: 'client', userId, tenantId: otherTenantId };
      const otherRef = await insertCve(RULE_CVE, { tenantId: otherTenantId });
      const otherAssets = [
        await createAsset(otherOrigin, 'internet_facing', 'host'),
        await createAsset(otherOrigin, 'internet_facing', 'host'),
      ];
      for (const assetId of otherAssets) {
        await finding(assetId, otherRef, { tenantId: otherTenantId });
      }

      expect(countsOf(await attackOf(RULE_CVE))).toEqual({ 'T1190/exploitation': 2, 'T1210/exploitation': 4 });
      expect(countsOf(await attackOf(RULE_CVE, null, otherOrigin))).toEqual({ 'T1190/exploitation': 2 });
      expect(await listedAssets({ cveId: RULE_CVE, technique: 'T1190' }, otherOrigin)).toEqual(otherAssets.toSorted());
    });
  });
});
