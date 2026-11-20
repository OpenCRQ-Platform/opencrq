import type { EventOrigin } from '@app/module';
import {
  BusinessValueCategory_PersonalData,
  crqIndicatorsRepository,
  cve,
  deriveSeedId,
  supportingAssetIdentityProperties,
  supportingAssetRelations,
  supportingAssets,
  supportingAssetSources,
} from '@app/module';
import { inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { EXPOSED_ESTATE, recomputeFindingScores, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * What the door reads from the database: the estate at the grain of its applicability rule, and the
 * openings the finding recompute stored. Both narrow to the scope's estate the way every other
 * estate read does.
 */
describe('the door estate reads', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;
  let primaryAssetId: string;
  let assetIdByName: ReadonlyMap<string, string>;
  let findingIdByKey: ReadonlyMap<string, string>;

  const open = { mode: 'open' } as const;

  /** The door reads a CVE by its row id alone, so the test names it back from the catalogue. */
  const cveNamesOf = async (openings: ReadonlyArray<{ cveId: string }>): Promise<Array<string>> => {
    const rows = await db.select({ id: cve.id, cveId: cve.cveId }).from(cve).where(inArray(cve.id, openings.map((row) => row.cveId)));
    const nameById = new Map(rows.map((row) => [row.id, row.cveId]));
    return openings.map((row) => nameById.get(row.cveId)!);
  };

  const identity = async (name: string, observations: ReadonlyArray<boolean | null>, owner: string = tenantId) => {
    const id = uuidv7();
    await db.insert(supportingAssets).values({
      id, tenantId: owner, name, exposure: 'internal', categoryId: 'identity', subcategoryId: 'user_account', criticality: 'low',
    });
    for (const [index, isEnabled] of observations.entries()) {
      const sourceId = uuidv7();
      await db.insert(supportingAssetSources).values({
        id: sourceId, supportingAssetId: id, tenantId: owner, sourceAssetId: `${name}-${index}`, reportedCategoryId: 'identity',
      });
      await db.insert(supportingAssetIdentityProperties).values({
        id: sourceId, supportingAssetSourceId: sourceId, tenantId: owner, isEnabled,
      });
    }
    return id;
  };

  const enabledCounts = async (owner: string = tenantId, origin: EventOrigin = adminOrigin) => {
    const rows = await crqIndicatorsRepository.findDoorEstateCounts(repositoryContextOf(db, origin), owner, open, []);
    const identities = rows.filter((row) => row.categoryId === 'identity' && row.subcategoryId === 'user_account');
    return {
      enabled: identities.filter((row) => row.identityEnabled).reduce((sum, row) => sum + row.count, 0),
      disabled: identities.filter((row) => !row.identityEnabled).reduce((sum, row) => sum + row.count, 0),
    };
  };

  const primaryAsset = async (name: string) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id,
      organizationId,
      name,
      description: null,
      ownerId: null,
      businessValueCategoryIds: [deriveSeedId(tenantId, BusinessValueCategory_PersonalData)],
    });
    return id;
  };

  const link = async (assetName: string, primaryId: string) => {
    await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
      { id: uuidv7(), supportingAssetId: assetIdByName.get(assetName)!, primaryAssetId: primaryId },
    ]);
  };

  const countsBySide = async (primaryAssetIds: Array<string>) => {
    const rows = await crqIndicatorsRepository.findDoorEstateCounts(repositoryContextOf(db, adminOrigin), tenantId, open, primaryAssetIds);
    const sumOf = (target: boolean) => rows.filter((row) => row.target === target).reduce((sum, row) => sum + row.count, 0);
    return { target: sumOf(true), other: sumOf(false) };
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    ({ organizationId, primaryAssetId, assetIdByName, findingIdByKey } = await seedAttackRunScenario(services, adminOrigin, tenantId, EXPOSED_ESTATE));
  });

  it('should count the assets by family, subcategory, exposure and identity state', async () => {
    const rows = await crqIndicatorsRepository.findDoorEstateCounts(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId]);

    const countOf = (categoryId: string, exposure: string) => rows
      .filter((row) => row.categoryId === categoryId && row.exposure === exposure)
      .reduce((sum, row) => sum + row.count, 0);
    expect(countOf('host', 'internet_facing')).toBe(2);
    expect(countOf('host', 'internal')).toBe(44);
    expect(countOf('network_device', 'internal')).toBe(6);
    expect(countOf('identity', 'unknown')).toBe(52);
    expect(rows.every((row) => row.identityEnabled)).toBe(true);
    expect(rows.filter((row) => row.subcategoryId !== null)).toEqual([expect.objectContaining({ categoryId: 'identity', subcategoryId: 'user_account', count: 40 })]);
  });

  it('should count the assets a primary asset of the scenario depends on as targets', async () => {
    expect(await countsBySide([primaryAssetId])).toEqual({ target: 4, other: 100 });
  });

  it('should count an asset linked to two primary assets of the scenario once', async () => {
    const second = await primaryAsset('Payment records');
    await link('Crown jewel 1', second);
    await link('Workstation 1', second);

    expect(await countsBySide([primaryAssetId, second])).toEqual({ target: 5, other: 99 });
  });

  it('should not count as a target an asset linked to the primary asset of another scenario', async () => {
    const elsewhere = await primaryAsset('Other scenario records');
    await link('Workstation 1', elsewhere);

    expect(await countsBySide([primaryAssetId])).toEqual({ target: 4, other: 100 });
    expect(await countsBySide([elsewhere])).toEqual({ target: 1, other: 103 });
  });

  it('should count no target when the scenario has no primary asset', async () => {
    expect(await countsBySide([])).toEqual({ target: 0, other: 104 });
  });

  it('should carry the target flag on each opening', async () => {
    await link('Web server 1', primaryAssetId);

    const openings = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId]);

    expect(openings.length).toBeGreaterThan(0);
    for (const row of openings) {
      expect(row.target).toBe(row.supportingAssetId === assetIdByName.get('Web server 1'));
    }
    expect(openings.some((row) => row.target)).toBe(true);
    expect(openings.some((row) => !row.target)).toBe(true);
  });

  it('should carry no target flag on an opening when the scenario has no primary asset', async () => {
    await link('Web server 1', primaryAssetId);

    const openings = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, []);

    expect(openings.length).toBeGreaterThan(0);
    expect(openings.every((row) => !row.target)).toBe(true);
  });

  it('should read an opening of an asset linked to two primary assets once', async () => {
    const second = await primaryAsset('Payment records');
    await link('Web server 1', primaryAssetId);
    await link('Web server 1', second);

    const withTwo = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId, second]);
    const without = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, []);

    expect(withTwo).toHaveLength(without.length);
  });

  it('should read an identity as disabled only when every observation that fills is_enabled says so', async () => {
    const seeded = await enabledCounts();
    await identity('all off', [false]);
    await identity('two off', [false, false]);
    await identity('one on', [false, true]);
    await identity('never said', [null]);
    await identity('said, then not', [null, false]);
    await identity('no observation', []);

    expect(await enabledCounts()).toEqual({ enabled: seeded.enabled + 3, disabled: seeded.disabled + 3 });
  });

  it('should narrow both reads to the mapped assets of a closed scope', async () => {
    const closed = { mode: 'closed', organizationId } as const;
    await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, {
      estateMode: 'closed',
      mapping: { added: [assetIdByName.get('Web server 1')!, assetIdByName.get('Workstation 1')!], removed: [] },
    });

    const counts = await crqIndicatorsRepository.findDoorEstateCounts(repositoryContextOf(db, adminOrigin), tenantId, closed, [primaryAssetId]);
    const openings = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, closed, [primaryAssetId]);

    expect(counts.reduce((sum, row) => sum + row.count, 0)).toBe(2);
    expect(openings.length).toBeGreaterThan(0);
    expect(new Set(openings.map((row) => row.supportingAssetId))).toEqual(new Set([assetIdByName.get('Web server 1')]));
  });

  it('should read each opening with its asset family, its CVE and its technique', async () => {
    const openings = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId]);

    const names = await cveNamesOf(openings);
    const onListed = openings.filter((_, index) => names[index] === 'CVE-2021-44228');
    expect(onListed.map((row) => row.supportingAssetId)).toEqual(onListed.map(() => assetIdByName.get('Web server 1')));
    expect(onListed).toContainEqual(expect.objectContaining({ categoryId: 'host', techniqueExternalId: 'T1190', threat: 0.984 }));
    expect(onListed.find((row) => row.techniqueExternalId === 'T1190')!.opening).toBeCloseTo(1);
    expect(new Set(names)).toEqual(new Set(['CVE-2021-44228', 'CVE-2099-0001']));
  });

  it('should read the asset subcategory and exposure beside each opening', async () => {
    const openings = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId]);

    expect(openings.length).toBeGreaterThan(0);
    expect(openings.every((row) => row.exposure === 'internet_facing' && row.subcategoryId === null)).toBe(true);
  });

  it('should not read a finding dismissed after the last recompute', async () => {
    const dismissed = assetIdByName.get('Web server 1')!;
    const before = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId]);
    expect(before.filter((row) => row.supportingAssetId === dismissed)).not.toEqual([]);

    await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
      evidenceId: findingIdByKey.get('CVE-2021-44228@Web server 1')!,
      dismissalType: 'risk_accepted',
      reasonCode: 'wont_fix',
      reason: 'Accepted',
      changedByUserId: adminUserId,
    });

    const openings = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId]);
    expect(openings.filter((row) => row.supportingAssetId === dismissed)).toEqual([]);
    expect(new Set(await cveNamesOf(openings))).toEqual(new Set(['CVE-2099-0001']));
  });

  it('should read a finding reopened after the last recompute, which ran while it was dismissed', async () => {
    const reopened = assetIdByName.get('Web server 1')!;
    const evidenceId = findingIdByKey.get('CVE-2021-44228@Web server 1')!;
    await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
      evidenceId,
      dismissalType: 'risk_accepted',
      reasonCode: 'wont_fix',
      reason: 'Accepted',
      changedByUserId: adminUserId,
    });
    await recomputeFindingScores(services, adminOrigin);

    await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({ evidenceId, changedByUserId: adminUserId });

    const openings = await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, adminOrigin), tenantId, open, [primaryAssetId]);
    expect(openings.filter((row) => row.supportingAssetId === reopened)).not.toEqual([]);
    expect(new Set(await cveNamesOf(openings))).toEqual(new Set(['CVE-2021-44228', 'CVE-2099-0001']));
  });

  it('should never read another tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
    await identity('someone else', [true], otherTenantId);

    expect(await enabledCounts(tenantId, otherOrigin)).toEqual({ enabled: 0, disabled: 0 });
    expect(await crqIndicatorsRepository.findEntryOpenings(repositoryContextOf(db, otherOrigin), tenantId, open, [primaryAssetId])).toEqual([]);
    expect(await enabledCounts(otherTenantId, otherOrigin)).toEqual({ enabled: 1, disabled: 0 });
  });

  describe('the primary users', () => {
    const connectorOf = async (origin: EventOrigin, source: 'microsoft_graph' | 'openaev' = 'microsoft_graph') => {
      await services.withOrigin(origin).integrationSettings.configureIntegration(source, null);
      return (await services.withOrigin(origin).integrationSettings.getConnectorId(source))!;
    };

    const relate = async (
      identityId: string,
      deviceId: string,
      connectorId: string,
      owner: string = tenantId,
    ) => db.insert(supportingAssetRelations).values({
      id: uuidv7(),
      tenantId: owner,
      connectorId,
      fromAssetId: identityId,
      toAssetId: deviceId,
      kind: 'primary_user_of',
      source: 'entra_registered_owner',
      firstSeenAt: new Date(),
      lastReportedAt: new Date(),
    });

    const primaryUsers = (estate: Parameters<typeof crqIndicatorsRepository.findPrimaryUsers>[2] = open, primaryAssetIds: Array<string> = [primaryAssetId]) =>
      crqIndicatorsRepository.findPrimaryUsers(repositoryContextOf(db, adminOrigin), tenantId, estate, primaryAssetIds);

    it('should read an enabled user account with each device it is the primary user of', async () => {
      const connectorId = await connectorOf(adminOrigin);
      const nadia = await identity('Nadia', [true]);
      await relate(nadia, assetIdByName.get('Workstation 1')!, connectorId);
      await relate(nadia, assetIdByName.get('Workstation 2')!, connectorId);

      const pairs = await primaryUsers();

      expect(pairs).toHaveLength(2);
      expect(new Set(pairs.map((pair) => pair.deviceId))).toEqual(new Set([assetIdByName.get('Workstation 1'), assetIdByName.get('Workstation 2')]));
      expect(pairs.every((pair) => pair.identityId === nadia && !pair.identityTarget)).toBe(true);
    });

    it('should read the family of each device, and no device phishing does not reach', async () => {
      const connectorId = await connectorOf(adminOrigin);
      const nadia = await identity('Nadia', [true]);
      const phone = uuidv7();
      const server = uuidv7();
      await db.insert(supportingAssets).values([
        { id: phone, tenantId, name: 'Nadia phone', exposure: 'internal', categoryId: 'mobile_device', subcategoryId: null, criticality: 'low' },
        { id: server, tenantId, name: 'Nadia server', exposure: 'internal', categoryId: 'host', subcategoryId: 'server', criticality: 'low' },
      ]);
      await relate(nadia, assetIdByName.get('Workstation 1')!, connectorId);
      await relate(nadia, phone, connectorId);
      await relate(nadia, server, connectorId);

      const pairs = await primaryUsers();

      expect(pairs.map((pair) => [pair.deviceId, pair.deviceCategoryId]).sort()).toEqual([
        [assetIdByName.get('Workstation 1'), 'host'],
        [phone, 'mobile_device'],
      ].sort());
    });

    it('should read nothing when no relation was reported', async () => {
      expect(await primaryUsers()).toEqual([]);
    });

    it('should not read a disabled account as a person, and read one with no observation as enabled', async () => {
      const connectorId = await connectorOf(adminOrigin);
      const left = await identity('Left the company', [false]);
      const unobserved = await identity('Unobserved', []);
      await relate(left, assetIdByName.get('Workstation 1')!, connectorId);
      await relate(unobserved, assetIdByName.get('Workstation 2')!, connectorId);

      expect((await primaryUsers()).map((pair) => pair.identityId)).toEqual([unobserved]);
    });

    it('should not read as a person an identity that is not a user account', async () => {
      const connectorId = await connectorOf(adminOrigin);
      await relate(assetIdByName.get('Service account 1')!, assetIdByName.get('Workstation 1')!, connectorId);

      expect(await primaryUsers()).toEqual([]);
    });

    it('should read a pair two connectors reported once', async () => {
      const graph = await connectorOf(adminOrigin);
      const openaev = await connectorOf(adminOrigin, 'openaev');
      const nadia = await identity('Nadia', [true]);
      await relate(nadia, assetIdByName.get('Workstation 1')!, graph);
      await relate(nadia, assetIdByName.get('Workstation 1')!, openaev);

      expect(await primaryUsers()).toEqual([{ identityId: nadia, deviceId: assetIdByName.get('Workstation 1'), deviceCategoryId: 'host', identityTarget: false }]);
    });

    it('should flag as a target the account a primary asset of the scenario depends on, and not one only another scenario does', async () => {
      const connectorId = await connectorOf(adminOrigin);
      const nadia = await identity('Nadia', [true]);
      const claire = await identity('Claire', [true]);
      await relate(nadia, assetIdByName.get('Workstation 1')!, connectorId);
      await relate(claire, assetIdByName.get('Workstation 2')!, connectorId);
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([
        { id: uuidv7(), supportingAssetId: nadia, primaryAssetId },
        { id: uuidv7(), supportingAssetId: claire, primaryAssetId: await primaryAsset('Other scenario records') },
      ]);

      const pairs = await primaryUsers();

      expect(pairs.find((pair) => pair.identityId === nadia)?.identityTarget).toBe(true);
      expect(pairs.find((pair) => pair.identityId === claire)?.identityTarget).toBe(false);
    });

    it('should flag no account as a target when the scenario has no primary asset', async () => {
      const connectorId = await connectorOf(adminOrigin);
      const nadia = await identity('Nadia', [true]);
      await relate(nadia, assetIdByName.get('Workstation 1')!, connectorId);
      await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: nadia, primaryAssetId }]);

      expect((await primaryUsers(open, [])).map((pair) => pair.identityTarget)).toEqual([false]);
    });

    it('should read only the pairs both of whose ends are mapped by a closed scope', async () => {
      const connectorId = await connectorOf(adminOrigin);
      const mapped = await identity('Mapped', [true]);
      const unmapped = await identity('Unmapped', [true]);
      await relate(mapped, assetIdByName.get('Workstation 1')!, connectorId);
      await relate(mapped, assetIdByName.get('Workstation 2')!, connectorId);
      await relate(unmapped, assetIdByName.get('Workstation 1')!, connectorId);
      await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, {
        estateMode: 'closed',
        mapping: { added: [mapped, assetIdByName.get('Workstation 1')!], removed: [] },
      });

      expect(await primaryUsers({ mode: 'closed', organizationId })).toEqual([
        { identityId: mapped, deviceId: assetIdByName.get('Workstation 1'), deviceCategoryId: 'host', identityTarget: false },
      ]);
    });

    it('should never read the pairs of another tenant', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherConnector = await connectorOf(otherOrigin);
      const someoneElse = await identity('Someone else', [true], otherTenantId);
      const otherDevice = uuidv7();
      await db.insert(supportingAssets).values({
        id: otherDevice, tenantId: otherTenantId, name: 'Their laptop', exposure: 'internal', categoryId: 'host', subcategoryId: 'laptop', criticality: 'low',
      });
      await relate(someoneElse, otherDevice, otherConnector, otherTenantId);

      expect(await primaryUsers()).toEqual([]);
      expect(await crqIndicatorsRepository.findPrimaryUsers(repositoryContextOf(db, adminOrigin), otherTenantId, open, [])).toEqual([]);
      expect(await crqIndicatorsRepository.findPrimaryUsers(repositoryContextOf(db, otherOrigin), otherTenantId, open, []))
        .toEqual([{ identityId: someoneElse, deviceId: otherDevice, deviceCategoryId: 'host', identityTarget: false }]);
    });
  });
});
