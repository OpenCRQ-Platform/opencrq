import type { AssetGroupMemberSource } from '../../modules/supporting-assets/schema';
import { assetGroupMembers, assetGroups, supportingAssetTags, tags, tagSources } from '../../modules/supporting-assets/schema';
import {
  AssetGroup_CrownJewels,
  AssetGroup_PaymentsEstate,
  AssetGroup_TierOneServers,
  assetGroupMemberId,
  hostCriticalityAssetId,
  IntegrationSetting_AcmeOpenaev,
  SupportingAsset_CardAuthEngine,
  SupportingAsset_CoreBanking,
  SupportingAsset_InternetBanking,
  SupportingAsset_MobileBanking,
  SupportingAsset_OracleExadata,
  SupportingAsset_PaymentGateway,
  SupportingAssetTag_PaymentGatewayPciScope,
  Tag_PciScope,
  TagSource_PciScopeXtmOne,
  Tenant_Acme,
  User_Admin,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

/**
 * Asset groups and the XTM One tag origin (#3152, section 2), so the asset list's Groups column, its
 * group filter and the tag management page have something to show on a fresh platform: one group per
 * membership origin (a person, the OpenAEV sync, an XTM One push), an asset in two groups, and a tag
 * XTM One pushed next to the OpenAEV and manual ones the supporting-assets seeder writes. Runs after
 * the host-criticality seeder, whose hosts the OpenAEV group holds.
 */
registerPlatformSeed('asset-groups', async ({ db }) => {
  await db.insert(assetGroups).values([
    {
      id: AssetGroup_PaymentsEstate,
      tenantId: Tenant_Acme,
      name: 'Payments estate',
      description: 'Everything that authorises, routes or settles a card payment.',
    },
    {
      id: AssetGroup_TierOneServers,
      tenantId: Tenant_Acme,
      name: 'Tier 1 servers',
      description: 'Servers OpenAEV groups for its tier 1 simulations.',
      connectorId: IntegrationSetting_AcmeOpenaev,
      sourceGroupId: 'openaev-asset-group-tier-1-servers',
    },
    {
      id: AssetGroup_CrownJewels,
      tenantId: Tenant_Acme,
      name: 'Crown jewels',
      description: 'The assets XTM One flags as crown jewels.',
      externalReference: 'xtm-one:crown-jewels',
    },
  ]);

  const members: ReadonlyArray<{ group: string, asset: string, source: AssetGroupMemberSource }> = [
    { group: AssetGroup_PaymentsEstate, asset: SupportingAsset_PaymentGateway, source: 'manual' },
    { group: AssetGroup_PaymentsEstate, asset: SupportingAsset_CardAuthEngine, source: 'manual' },
    { group: AssetGroup_PaymentsEstate, asset: SupportingAsset_InternetBanking, source: 'manual' },
    { group: AssetGroup_PaymentsEstate, asset: SupportingAsset_MobileBanking, source: 'manual' },
    // ACME-DC-01, ACME-BKP-01 and ACME-SRV-0412, the first three hosts of the host-criticality seeder.
    { group: AssetGroup_TierOneServers, asset: hostCriticalityAssetId(0), source: 'connector' },
    { group: AssetGroup_TierOneServers, asset: hostCriticalityAssetId(1), source: 'connector' },
    { group: AssetGroup_TierOneServers, asset: hostCriticalityAssetId(2), source: 'connector' },
    // The payment gateway sits in two groups, so the Groups column shows more than one name.
    { group: AssetGroup_CrownJewels, asset: SupportingAsset_CoreBanking, source: 'xtm_one' },
    { group: AssetGroup_CrownJewels, asset: SupportingAsset_PaymentGateway, source: 'xtm_one' },
    { group: AssetGroup_CrownJewels, asset: SupportingAsset_OracleExadata, source: 'xtm_one' },
  ];
  await db.insert(assetGroupMembers).values(members.map(({ group, asset, source }, index) => ({
    id: assetGroupMemberId(index),
    tenantId: Tenant_Acme,
    assetGroupId: group,
    supportingAssetId: asset,
    source,
    connectorId: source === 'connector' ? IntegrationSetting_AcmeOpenaev : null,
    authorUserId: source === 'connector' ? null : User_Admin,
  })));

  // A tag only XTM One pushed: the third origin tag management lists.
  await db.insert(tags).values({ id: Tag_PciScope, tenantId: Tenant_Acme, name: 'pci-scope' });
  await db.insert(tagSources).values({
    id: TagSource_PciScopeXtmOne,
    tenantId: Tenant_Acme,
    tagId: Tag_PciScope,
    connectorId: null,
    sourceTagId: null,
    reportedName: 'pci-scope',
    reportedColor: null,
    pushedByXtmOne: true,
  });
  await db.insert(supportingAssetTags).values({
    id: SupportingAssetTag_PaymentGatewayPciScope,
    tenantId: Tenant_Acme,
    supportingAssetId: SupportingAsset_PaymentGateway,
    tagId: Tag_PciScope,
    connectorId: null,
    pushedByXtmOne: true,
  });
});
