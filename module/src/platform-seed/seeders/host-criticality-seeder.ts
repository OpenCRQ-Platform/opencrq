import type { AssetCriticality, AssetCriticalityRule } from '../../modules/supporting-assets/constants';
import { supportingAssetMachineProperties, supportingAssets, supportingAssetSources, supportingAssetTags } from '../../modules/supporting-assets/schema';
import {
  hostCriticalityAssetId,
  hostCriticalitySeedTagId,
  hostCriticalitySourceId,
  IntegrationSetting_AcmeMicrosoftGraph,
  Tag_SeedAcme,
  Tenant_Acme,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

interface HostSpec {
  name: string,
  /** A Defender device id: lower-case hex, the shape the connector keys a device by. */
  defenderDeviceId: string,
  criticality: AssetCriticality,
  rule: AssetCriticalityRule | null,
}

/**
 * Servers the Microsoft Graph connector rates from what Defender knows they are, so the detail shows
 * the rule behind a band without a Microsoft tenant. The seed writes the connector's reading, not
 * Defender's `DeviceRoles` and `AssetValue`, so each row names what it stands for:
 * - ACME-DC-01: a `DomainController` role, which Defender detects at Low confidence on a real estate and still counts.
 * - ACME-BKP-01: a backup server role.
 * - ACME-SRV-0412: `AssetValue` declared High.
 * - ACME-SRV-0418: `AssetValue` declared Normal, Defender's default, which states nothing.
 * - ACME-SQL-01: a database server, which no rule names, so it reads `unknown` like the one before.
 */
const HOST_SPECS: ReadonlyArray<HostSpec> = [
  { name: 'ACME-DC-01', defenderDeviceId: '1a3c5e7b9d0f2468ace13579bdf02468ace13501', criticality: 'very_high', rule: 'domain_controller' },
  { name: 'ACME-BKP-01', defenderDeviceId: '3c5e7a9b1d0f2468ace13579bdf02468ace13502', criticality: 'high', rule: 'backup' },
  { name: 'ACME-SRV-0412', defenderDeviceId: '5e7a9c1b3d0f2468ace13579bdf02468ace13503', criticality: 'high', rule: 'asset_value_high' },
  { name: 'ACME-SRV-0418', defenderDeviceId: '7a9c1e3b5d0f2468ace13579bdf02468ace13504', criticality: 'unknown', rule: null },
  { name: 'ACME-SQL-01', defenderDeviceId: '9c1e3a5b7d0f2468ace13579bdf02468ace13505', criticality: 'unknown', rule: null },
];

registerPlatformSeed('host-criticality', async ({ db, now }) => {
  const firstSeenAt = new Date('2025-06-02T00:00:00Z');
  const lastSeenAt = now;

  await db.insert(supportingAssets).values(HOST_SPECS.map((spec, index) => ({
    id: hostCriticalityAssetId(index),
    tenantId: Tenant_Acme,
    name: spec.name,
    exposure: 'internal' as const,
    categoryId: 'host' as const,
    subcategoryId: 'server' as const,
    criticality: spec.criticality,
    firstSeenAt,
    lastSeenAt,
  })));

  await db.insert(supportingAssetSources).values(HOST_SPECS.map((spec, index) => ({
    id: hostCriticalitySourceId(index),
    supportingAssetId: hostCriticalityAssetId(index),
    tenantId: Tenant_Acme,
    connectorId: IntegrationSetting_AcmeMicrosoftGraph,
    sourceAssetId: spec.defenderDeviceId,
    reportedName: spec.name,
    reportedCategoryId: 'host' as const,
    reportedSubcategoryId: 'server' as const,
    reportedExposure: 'internal' as const,
    reportedCriticality: spec.criticality,
    reportedCriticalityRule: spec.rule,
    firstSeenAt,
    lastSeenAt,
  })));

  // One-to-one with the source row, reusing its id, exactly as the connector writes them.
  await db.insert(supportingAssetMachineProperties).values(HOST_SPECS.map((spec, index) => ({
    id: hostCriticalitySourceId(index),
    supportingAssetSourceId: hostCriticalitySourceId(index),
    tenantId: Tenant_Acme,
    hostname: spec.name.toLowerCase(),
    platform: 'windows',
  })));

  await db.insert(supportingAssetTags).values(HOST_SPECS.map((_, index) => ({
    id: hostCriticalitySeedTagId(index),
    tenantId: Tenant_Acme,
    supportingAssetId: hostCriticalityAssetId(index),
    tagId: Tag_SeedAcme,
    connectorId: null,
  })));
});
