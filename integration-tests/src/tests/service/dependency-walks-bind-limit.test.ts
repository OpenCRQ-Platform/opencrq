import type { EventOrigin } from '@app/module';
import { assetDependenciesRepository, riskScenariosRepository } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

// Every test reads, so the estate is built once.
describe('the dependency walks past the 65,535 parameters a statement binds', () => {
  const pastBindLimit = 65_536;
  const repeated = (id: string) => Array.from({ length: pastBindLimit }, () => id);

  const organizationId = uuidv7();
  const primaryAssetId = uuidv7();
  const directId = uuidv7();
  const providerId = uuidv7();
  const drawnProviderId = uuidv7();
  let adminOrigin: EventOrigin;
  const context = () => repositoryContextOf(db, adminOrigin);

  beforeAll(async () => {
    await truncateAllTables(db);
    adminOrigin = (await createTenantWithAdmin(services)).origin;
    const scoped = services.withOrigin(adminOrigin);
    await scoped.organizations.createOrganizations([{ id: organizationId, name: 'Test Organization' }]);
    await scoped.primaryAssets.createPrimaryAsset({
      id: primaryAssetId, organizationId, name: 'Branch Banking Service', description: null, ownerId: null, businessValueCategoryIds: [],
    });
    for (const [id, name] of [[directId, 'Direct'], [providerId, 'Provider'], [drawnProviderId, 'Drawn Provider']]) {
      await scoped.supportingAssets.createSupportingAsset({ id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host' });
    }
    await scoped.assetDependencies.createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: directId, primaryAssetId }]);
    await scoped.assetDependencies.createSupportToSupportLinks([
      { id: uuidv7(), providerAssetId: providerId, dependentAssetId: directId },
      { id: uuidv7(), providerAssetId: drawnProviderId, dependentAssetId: directId },
    ]);
    await scoped.organizations.updateOrganization(organizationId, { mapping: { added: [providerId], removed: [] } });
  });

  describe('riskScenariosRepository, as a scenario walks the supporting assets below its primary assets', () => {
    it('should find the direct supporting assets of more primary assets than that', async () => {
      expect(await riskScenariosRepository.findDirectSupportingAssetsForPrimaryAssets(context(), repeated(primaryAssetId)))
        .toMatchObject([{ supportingAssetId: directId, primaryAssetId }]);
    });

    it('should find the providers of more supporting assets than that', async () => {
      const links = await riskScenariosRepository.findSupportingAssetProviders(context(), repeated(directId));

      expect(links.map((link) => link.providerAssetId).sort()).toEqual([providerId, drawnProviderId].sort());
    });

    it('should find which of more supporting assets than that the scope maps', async () => {
      expect(await riskScenariosRepository.findAssetIdsMappedToScope(context(), organizationId, [...repeated(providerId), directId])).toEqual([providerId]);
    });
  });

  describe('assetDependenciesRepository, as a dependency graph counts the assets it hides', () => {
    it('should find the provider ids of more supporting assets than that', async () => {
      const rows = await assetDependenciesRepository.findProviderIdsOf(context(), repeated(directId));

      expect(rows.map((row) => row.providerAssetId).sort()).toEqual([providerId, drawnProviderId].sort());
    });

    // A scenario's graph has no dependent frontier and draws at most DEPENDENCY_GRAPH_MAX_ASSETS assets.
    describe('on a supporting asset\'s graph, which draws every dependent', () => {
      it('should find the dependent ids of more supporting assets than that', async () => {
        expect(await assetDependenciesRepository.findDependentIdsOf(context(), repeated(providerId))).toEqual([{ dependentAssetId: directId }]);
      });

      it('should count the providers of more drawn assets than that', async () => {
        expect(await assetDependenciesRepository.countProvidersOf(context(), repeated(directId), [drawnProviderId]))
          .toEqual([{ dependentAssetId: directId, providerCount: 1 }]);
      });

      it('should leave out of the count more drawn providers than that', async () => {
        expect(await assetDependenciesRepository.countProvidersOf(context(), [directId], repeated(drawnProviderId)))
          .toEqual([{ dependentAssetId: directId, providerCount: 1 }]);
      });
    });
  });
});
