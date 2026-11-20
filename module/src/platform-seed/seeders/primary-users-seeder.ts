import type { AssetCriticality, AssetRelationSource, AssetSubcategory } from '../../modules/supporting-assets/constants';
import { supportingAssetCriticalityLifts, supportingAssetMachineProperties, supportingAssetRelations, supportingAssets, supportingAssetSources, supportingAssetTags } from '../../modules/supporting-assets/schema';
import {
  identityAssetId,
  IntegrationSetting_AcmeMicrosoftGraph,
  primaryUserRelationId,
  primaryUserWorkstationAssetId,
  primaryUserWorkstationSeedTagId,
  primaryUserWorkstationSourceId,
  Tag_SeedAcme,
  Tenant_Acme,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

interface WorkstationSpec {
  name: string,
  subcategoryId: AssetSubcategory,
  /** A Defender device id: lower-case hex, the shape the connector keys a device by. */
  defenderDeviceId: string,
  directoryDeviceId: string | null,
  macAddresses: Array<string>,
  platform: string,
  /** Index into the identities seeder's specs. */
  primaryUserSpecIndex: number,
  source: AssetRelationSource,
  /** The band the lift job gives it, one below its primary user's in effect: a seed runs no job. */
  lift: AssetCriticality | null,
}

const NADIA_FOURNIER = 0;
const CLAIRE_DUBOIS = 5;
const KARIM_BENALI = 6;
const JULIEN_MOREAU = 7;

/**
 * Workstations the Microsoft Graph connector names a primary user for, so both details show the
 * relation without a Microsoft tenant: one of each source, and one identity with two machines. The
 * Mac carries no Entra device id, as on a real estate, and is reached by Intune on its MAC.
 *
 * Their bands show the lift: one machine each for a `very_high` and a `high` user, lifted to `high`
 * and `medium`, and Nadia Fournier's two, which her hand-set `medium` lifts nothing.
 */
const WORKSTATION_SPECS: ReadonlyArray<WorkstationSpec> = [
  {
    name: 'ACME-LT-0142',
    subcategoryId: 'laptop',
    defenderDeviceId: '5e2a91c04b7d3f6a8e1c0d9b2a4f7e6c3b5d8a01',
    directoryDeviceId: 'a3f1c6d2-7b4e-4c9a-8d5f-1e2b3c4d5e01',
    macAddresses: ['f8e43b1c2a01'],
    platform: 'windows',
    primaryUserSpecIndex: NADIA_FOURNIER,
    source: 'entra_registered_owner',
    lift: null,
  },
  {
    name: 'ACME-MB-0087',
    subcategoryId: 'laptop',
    defenderDeviceId: '7c4b2e9d1a6f3085b2e7c4d9a1f6b3e8c5d2a702',
    directoryDeviceId: null,
    macAddresses: ['3c22fb6e9d02'],
    platform: 'macos',
    primaryUserSpecIndex: NADIA_FOURNIER,
    source: 'intune_primary_user',
    lift: null,
  },
  {
    name: 'ACME-WS-0311',
    subcategoryId: 'workstation',
    defenderDeviceId: '9d6c3f0e2b8a4157c3f9d6e0b2a8c4f7d1e3b903',
    directoryDeviceId: 'b7e2d4f1-3c6a-4e8b-9f1d-2c3b4a5e6f03',
    macAddresses: ['00d861a4b703'],
    platform: 'windows',
    primaryUserSpecIndex: CLAIRE_DUBOIS,
    source: 'entra_registered_owner',
    lift: null,
  },
  {
    name: 'ACME-LT-0219',
    subcategoryId: 'laptop',
    defenderDeviceId: '2f8d4b6a0c1e3957a2d4f6b8c0e1a3d5f7b9c204',
    directoryDeviceId: 'c4d8e2a6-1f3b-4d7c-8e9a-3b4c5d6e7f04',
    macAddresses: ['5c8a1e2d3f05'],
    platform: 'windows',
    primaryUserSpecIndex: KARIM_BENALI,
    source: 'entra_registered_owner',
    lift: 'high',
  },
  {
    name: 'ACME-LT-0233',
    subcategoryId: 'laptop',
    defenderDeviceId: '6b0e2c4a8d1f3579b2c4e6a8d0f1b3c5e7a9d305',
    directoryDeviceId: 'd5e9f3b7-2a4c-4e8d-9f0b-4c5d6e7f8a05',
    macAddresses: ['7e1c3a5b9d06'],
    platform: 'windows',
    primaryUserSpecIndex: JULIEN_MOREAU,
    source: 'entra_registered_owner',
    lift: 'medium',
  },
];

/**
 * Karim Benali's laptop, which Entra also registers to Julien Moreau: a device two identities share, whose
 * band comes from the higher of them only, so two levels around either user reach the other.
 */
const SHARED_WORKSTATION_SPEC_INDEX = 3;
const SHARED_WORKSTATION_SECOND_USER = JULIEN_MOREAU;

registerPlatformSeed('primary-users', async ({ db, now }) => {
  const firstSeenAt = new Date('2025-06-02T00:00:00Z');
  const lastSeenAt = now;

  await db.insert(supportingAssets).values(WORKSTATION_SPECS.map((spec, index) => ({
    id: primaryUserWorkstationAssetId(index),
    tenantId: Tenant_Acme,
    name: spec.name,
    exposure: 'internal' as const,
    categoryId: 'host' as const,
    subcategoryId: spec.subcategoryId,
    criticality: spec.lift ?? 'unknown',
    firstSeenAt,
    lastSeenAt,
  })));

  await db.insert(supportingAssetSources).values(WORKSTATION_SPECS.map((spec, index) => ({
    id: primaryUserWorkstationSourceId(index),
    supportingAssetId: primaryUserWorkstationAssetId(index),
    tenantId: Tenant_Acme,
    connectorId: IntegrationSetting_AcmeMicrosoftGraph,
    sourceAssetId: spec.defenderDeviceId,
    reportedName: spec.name,
    reportedCategoryId: 'host' as const,
    reportedSubcategoryId: spec.subcategoryId,
    reportedExposure: 'internal' as const,
    reportedCriticality: 'unknown' as const,
    firstSeenAt,
    lastSeenAt,
  })));

  // One-to-one with the source row, reusing its id, exactly as the connector writes them.
  await db.insert(supportingAssetMachineProperties).values(WORKSTATION_SPECS.map((spec, index) => ({
    id: primaryUserWorkstationSourceId(index),
    supportingAssetSourceId: primaryUserWorkstationSourceId(index),
    tenantId: Tenant_Acme,
    hostname: spec.name.toLowerCase(),
    macAddresses: spec.macAddresses,
    directoryDeviceId: spec.directoryDeviceId,
    platform: spec.platform,
  })));

  await db.insert(supportingAssetTags).values(WORKSTATION_SPECS.map((_, index) => ({
    id: primaryUserWorkstationSeedTagId(index),
    tenantId: Tenant_Acme,
    supportingAssetId: primaryUserWorkstationAssetId(index),
    tagId: Tag_SeedAcme,
    connectorId: null,
  })));

  await db.insert(supportingAssetRelations).values([
    ...WORKSTATION_SPECS.map((spec, index) => ({
      id: primaryUserRelationId(index),
      tenantId: Tenant_Acme,
      connectorId: IntegrationSetting_AcmeMicrosoftGraph,
      fromAssetId: identityAssetId(spec.primaryUserSpecIndex),
      toAssetId: primaryUserWorkstationAssetId(index),
      kind: 'primary_user_of' as const,
      source: spec.source,
      firstSeenAt,
      lastReportedAt: lastSeenAt,
    })),
    {
      id: primaryUserRelationId(WORKSTATION_SPECS.length),
      tenantId: Tenant_Acme,
      connectorId: IntegrationSetting_AcmeMicrosoftGraph,
      fromAssetId: identityAssetId(SHARED_WORKSTATION_SECOND_USER),
      toAssetId: primaryUserWorkstationAssetId(SHARED_WORKSTATION_SPEC_INDEX),
      kind: 'primary_user_of' as const,
      source: 'entra_registered_owner' as const,
      firstSeenAt,
      lastReportedAt: lastSeenAt,
    },
  ]);

  await db.insert(supportingAssetCriticalityLifts).values(WORKSTATION_SPECS.flatMap((spec, index) => (spec.lift === null ? [] : [{
    supportingAssetId: primaryUserWorkstationAssetId(index),
    tenantId: Tenant_Acme,
    criticality: spec.lift,
    fromAssetId: identityAssetId(spec.primaryUserSpecIndex),
  }])));
});
