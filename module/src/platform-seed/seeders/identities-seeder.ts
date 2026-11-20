import type { AssetCriticality, AssetIdentityProvider, AssetSubcategory } from '../../modules/supporting-assets/constants';
import { supportingAssetIdentityProperties, supportingAssetManualValues, supportingAssets, supportingAssetSources, supportingAssetTags } from '../../modules/supporting-assets/schema';
import {
  identityAssetId,
  identityAssetSourceId,
  identitySeedTagId,
  IntegrationSetting_AcmeMicrosoftGraph,
  logonOnlyIdentityAssetId,
  logonOnlyIdentitySeedTagId,
  logonOnlyIdentitySourceId,
  sparseIdentityAssetId,
  sparseIdentitySeedTagId,
  Tag_SeedAcme,
  Tenant_Acme,
  User_Admin,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

/**
 * Identities as the Microsoft Graph connector produces them: one asset per account, the band read
 * from technical privilege, and everything Defender states in a property row beside it.
 *
 * Shaped to cover what the list and the detail have to show without a Microsoft tenant — every
 * criticality band, both glance marks, and the two identity providers — rather than to look like a
 * real directory, which would be thousands of unremarkable accounts.
 */
interface IdentitySpec {
  name: string,
  subcategoryId: AssetSubcategory,
  criticality: AssetCriticality,
  directoryType: string,
  identityProvider: AssetIdentityProvider,
  /** The Entra object id, a GUID; null on an account the directory knows by its on-premises SID alone. */
  directoryObjectId: string | null,
  cloudSid: string | null,
  onPremSid: string | null,
  userPrincipalName: string | null,
  accountName: string,
  department: string | null,
  jobTitle: string | null,
  assignedRoles: Array<string>,
}

const ACCOUNT_DOMAIN = 'acme';

/** Nadia Fournier, whose band a person pinned below what the connector reported, so the pin visibly wins. */
const PINNED_SPEC_INDEX = 0;
const PINNED_CRITICALITY: AssetCriticality = 'medium';

/** Identities with no property row at all, so the detail must draw no Identity card rather than an empty one. */
const SPARSE_IDENTITY_SPECS: ReadonlyArray<{ name: string }> = [
  { name: 'External auditor' },
];

/**
 * Accounts only the logon events name: the directory never returned them, so the connector files
 * the SID, the domain and the account name, and nothing else.
 */
const LOGON_ONLY_IDENTITY_SPECS: ReadonlyArray<{ onPremSid: string, accountName: string }> = [
  { onPremSid: 'S-1-5-21-2001-2002-2003-2240', accountName: 'svc_backup' },
];

const IDENTITY_SPECS: ReadonlyArray<IdentitySpec> = [
  {
    name: 'Nadia Fournier',
    subcategoryId: 'user_account',
    criticality: 'very_high',
    directoryType: 'User',
    identityProvider: 'entra',
    directoryObjectId: '7f3c2a91-4d5e-4b8a-9c1f-2e6d8a4b3c01',
    cloudSid: 'S-1-12-1-4001-4002-4003-4004',
    onPremSid: 'S-1-5-21-2001-2002-2003-1104',
    userPrincipalName: 'n.fournier@acme.example',
    accountName: 'nfournier',
    department: 'IT',
    jobTitle: 'Directory Architect',
    assignedRoles: ['Global Administrator'],
  },
  {
    name: 'Entra Connect Sync',
    subcategoryId: 'service_account',
    criticality: 'high',
    directoryType: 'ServiceAccount',
    identityProvider: 'active_directory',
    directoryObjectId: null,
    cloudSid: null,
    onPremSid: 'S-1-5-21-2001-2002-2003-1512',
    userPrincipalName: null,
    accountName: 'svc-entra-connect',
    department: null,
    jobTitle: null,
    assignedRoles: ['Hybrid Identity Administrator'],
  },
  {
    name: 'Payments Reconciliation Job',
    subcategoryId: 'non_human_identity',
    criticality: 'medium',
    directoryType: 'ServicePrincipal',
    identityProvider: 'entra',
    directoryObjectId: '2b8e6f14-9a3c-4d7e-8f2a-5c1b9e7d4a02',
    cloudSid: 'S-1-12-1-5001-5002-5003-5004',
    onPremSid: null,
    userPrincipalName: null,
    accountName: 'sp-payments-recon',
    department: null,
    jobTitle: null,
    assignedRoles: [],
  },
  {
    name: 'Customer Complaints',
    subcategoryId: 'shared_mailbox',
    criticality: 'low',
    directoryType: 'SharedMailbox',
    identityProvider: 'entra',
    directoryObjectId: 'c41d9e27-6b8f-4a3c-9d5e-8f2a1b7c6e03',
    cloudSid: 'S-1-12-1-6001-6002-6003-6004',
    onPremSid: null,
    userPrincipalName: 'complaints@acme.example',
    accountName: 'complaints',
    department: 'Customer Care',
    jobTitle: null,
    assignedRoles: [],
  },
  {
    name: 'Tomas Ricci',
    subcategoryId: 'user_account',
    criticality: 'unknown',
    directoryType: 'User',
    identityProvider: 'active_directory',
    directoryObjectId: null,
    cloudSid: null,
    onPremSid: 'S-1-5-21-2001-2002-2003-1187',
    userPrincipalName: 't.ricci@acme.example',
    accountName: 'tricci',
    department: 'Retail Banking',
    jobTitle: 'Branch Adviser',
    assignedRoles: [],
  },
  {
    name: 'Claire Dubois',
    subcategoryId: 'user_account',
    criticality: 'low',
    directoryType: 'User',
    identityProvider: 'entra',
    directoryObjectId: '5d9e2b47-8c1a-4f3e-b6d2-7a4c9e1f8b06',
    cloudSid: 'S-1-12-1-7001-7002-7003-7004',
    onPremSid: null,
    userPrincipalName: 'c.dubois@acme.example',
    accountName: 'cdubois',
    department: 'Retail Banking',
    jobTitle: 'Relationship Manager',
    assignedRoles: [],
  },
  {
    name: 'Karim Benali',
    subcategoryId: 'user_account',
    criticality: 'very_high',
    directoryType: 'User',
    identityProvider: 'entra',
    directoryObjectId: '8b1e4f62-3a9d-4c7e-a5f0-6d2c8e4b1a07',
    cloudSid: 'S-1-12-1-8001-8002-8003-8004',
    onPremSid: null,
    userPrincipalName: 'k.benali@acme.example',
    accountName: 'kbenali',
    department: 'IT',
    jobTitle: 'Service Desk Lead',
    assignedRoles: ['Helpdesk Administrator'],
  },
  {
    name: 'Julien Moreau',
    subcategoryId: 'user_account',
    criticality: 'high',
    directoryType: 'User',
    identityProvider: 'entra',
    directoryObjectId: '3f7a2d95-6e1b-4b8c-9d4a-0c5e7f2b9a08',
    cloudSid: 'S-1-12-1-9001-9002-9003-9004',
    onPremSid: null,
    userPrincipalName: 'j.moreau@acme.example',
    accountName: 'jmoreau',
    department: 'Security Operations',
    jobTitle: 'SOC Analyst',
    assignedRoles: ['Security Reader'],
  },
];

registerPlatformSeed('identities', async ({ db, now }) => {
  const firstSeenAt = new Date('2025-06-02T00:00:00Z');
  const lastSeenAt = now;

  await db.insert(supportingAssets).values(IDENTITY_SPECS.map((spec, index) => ({
    id: identityAssetId(index),
    tenantId: Tenant_Acme,
    name: spec.name,
    exposure: 'unknown' as const,
    categoryId: 'identity' as const,
    subcategoryId: spec.subcategoryId,
    criticality: index === PINNED_SPEC_INDEX ? PINNED_CRITICALITY : spec.criticality,
    // Defender says who opened a session, never who a service account belongs to, so the connector
    // leaves this null and a later source fills it.
    linkedPerson: null,
    firstSeenAt,
    lastSeenAt,
  })));

  await db.insert(supportingAssetSources).values(IDENTITY_SPECS.map((spec, index) => ({
    id: identityAssetSourceId(index),
    supportingAssetId: identityAssetId(index),
    tenantId: Tenant_Acme,
    connectorId: IntegrationSetting_AcmeMicrosoftGraph,
    // The Entra object id where there is one, the SID otherwise: the same key the connector builds.
    sourceAssetId: spec.directoryObjectId ?? `sid:${spec.onPremSid ?? ''}`,
    reportedName: spec.name,
    reportedCategoryId: 'identity' as const,
    reportedSubcategoryId: spec.subcategoryId,
    reportedCriticality: spec.criticality,
    firstSeenAt,
    lastSeenAt,
  })));

  // One-to-one with the source row, reusing its id, exactly as the connector writes them.
  await db.insert(supportingAssetIdentityProperties).values(IDENTITY_SPECS.map((spec, index) => ({
    id: identityAssetSourceId(index),
    supportingAssetSourceId: identityAssetSourceId(index),
    tenantId: Tenant_Acme,
    directoryObjectId: spec.directoryObjectId,
    cloudSid: spec.cloudSid,
    onPremSid: spec.onPremSid,
    userPrincipalName: spec.userPrincipalName,
    accountDomain: ACCOUNT_DOMAIN,
    accountName: spec.accountName,
    directoryType: spec.directoryType,
    identityProvider: spec.identityProvider,
    department: spec.department,
    jobTitle: spec.jobTitle,
    isEnabled: true,
    assignedRoles: spec.assignedRoles,
    privilegedPimRoles: [],
  })));

  // Every seeded asset carries its tenant's `seed` tag, which is what tells seeded data from a
  // real estate's. An identity is no exception, and an integration test holds the whole seed to it.
  await db.insert(supportingAssetTags).values(IDENTITY_SPECS.map((_, index) => ({
    id: identitySeedTagId(index),
    tenantId: Tenant_Acme,
    supportingAssetId: identityAssetId(index),
    tagId: Tag_SeedAcme,
    connectorId: null,
  })));

  // A band someone set by hand, which outranks every connector's reading. The detail marks it as
  // set by a user, and the seed is the only place that case is visible without a Microsoft tenant.
  await db.insert(supportingAssetManualValues).values([{
    supportingAssetId: identityAssetId(PINNED_SPEC_INDEX),
    attribute: 'criticality' as const,
    value: PINNED_CRITICALITY,
    setByUserId: User_Admin,
  }]);

  const logonOnlyName = (spec: { accountName: string }) => `${ACCOUNT_DOMAIN}\\${spec.accountName}`;
  await db.insert(supportingAssets).values(LOGON_ONLY_IDENTITY_SPECS.map((spec, index) => ({
    id: logonOnlyIdentityAssetId(index),
    tenantId: Tenant_Acme,
    name: logonOnlyName(spec),
    exposure: 'unknown' as const,
    categoryId: 'identity' as const,
    subcategoryId: null,
    criticality: 'unknown' as const,
    linkedPerson: null,
    lastSeenAt,
  })));
  await db.insert(supportingAssetSources).values(LOGON_ONLY_IDENTITY_SPECS.map((spec, index) => ({
    id: logonOnlyIdentitySourceId(index),
    supportingAssetId: logonOnlyIdentityAssetId(index),
    tenantId: Tenant_Acme,
    connectorId: IntegrationSetting_AcmeMicrosoftGraph,
    sourceAssetId: `sid:${spec.onPremSid}`,
    reportedName: logonOnlyName(spec),
    reportedCategoryId: 'identity' as const,
    reportedSubcategoryId: null,
    reportedCriticality: 'unknown' as const,
    lastSeenAt,
  })));
  await db.insert(supportingAssetIdentityProperties).values(LOGON_ONLY_IDENTITY_SPECS.map((spec, index) => ({
    id: logonOnlyIdentitySourceId(index),
    supportingAssetSourceId: logonOnlyIdentitySourceId(index),
    tenantId: Tenant_Acme,
    onPremSid: spec.onPremSid,
    accountDomain: ACCOUNT_DOMAIN,
    accountName: spec.accountName,
    identityProvider: 'active_directory' as const,
    assignedRoles: [],
    privilegedPimRoles: [],
  })));
  await db.insert(supportingAssetTags).values(LOGON_ONLY_IDENTITY_SPECS.map((_, index) => ({
    id: logonOnlyIdentitySeedTagId(index),
    tenantId: Tenant_Acme,
    supportingAssetId: logonOnlyIdentityAssetId(index),
    tagId: Tag_SeedAcme,
    connectorId: null,
  })));

  // An identity nobody's connector reports, so no source files a property row and the detail has a
  // family with no block to render. The connector always files one for an account it sees, even one
  // known from a single logon event, so a hand-made asset is the only shape this case takes.
  await db.insert(supportingAssets).values(SPARSE_IDENTITY_SPECS.map((spec, index) => ({
    id: sparseIdentityAssetId(index),
    tenantId: Tenant_Acme,
    name: spec.name,
    exposure: 'unknown' as const,
    categoryId: 'identity' as const,
    subcategoryId: null,
    criticality: 'unknown' as const,
    linkedPerson: null,
    firstSeenAt,
    lastSeenAt,
  })));

  await db.insert(supportingAssetTags).values(SPARSE_IDENTITY_SPECS.map((_, index) => ({
    id: sparseIdentitySeedTagId(index),
    tenantId: Tenant_Acme,
    supportingAssetId: sparseIdentityAssetId(index),
    tagId: Tag_SeedAcme,
    connectorId: null,
  })));
});
