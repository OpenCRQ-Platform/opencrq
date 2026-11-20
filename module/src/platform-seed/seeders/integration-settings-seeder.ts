import { integrationSettings } from '../../modules/integration-settings/schema';
import {
  IntegrationSetting_AcmeCisa,
  IntegrationSetting_AcmeFirst,
  IntegrationSetting_AcmeMicrosoftGraph,
  IntegrationSetting_AcmeNist,
  IntegrationSetting_AcmeOpenaev,
  IntegrationSetting_TarnwickCisa,
  IntegrationSetting_TarnwickFirst,
  IntegrationSetting_TarnwickMicrosoftGraph,
  IntegrationSetting_TarnwickNist,
  IntegrationSetting_TarnwickOpenaev,
  ServiceAccount_CveSyncAcme,
  ServiceAccount_CveSyncTarnwick,
  Tenant_Acme,
  Tenant_Tarnwick,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('integration-settings', async ({ db }) => {
  await db.insert(integrationSettings).values([
    { id: IntegrationSetting_AcmeFirst, tenantId: Tenant_Acme, source: 'first', serviceAccountId: ServiceAccount_CveSyncAcme },
    { id: IntegrationSetting_AcmeNist, tenantId: Tenant_Acme, source: 'nist', serviceAccountId: ServiceAccount_CveSyncAcme },
    { id: IntegrationSetting_AcmeCisa, tenantId: Tenant_Acme, source: 'cisa', serviceAccountId: ServiceAccount_CveSyncAcme },
    { id: IntegrationSetting_AcmeMicrosoftGraph, tenantId: Tenant_Acme, source: 'microsoft_graph', serviceAccountId: ServiceAccount_CveSyncAcme },
    { id: IntegrationSetting_AcmeOpenaev, tenantId: Tenant_Acme, source: 'openaev', serviceAccountId: ServiceAccount_CveSyncAcme },
    { id: IntegrationSetting_TarnwickFirst, tenantId: Tenant_Tarnwick, source: 'first', serviceAccountId: ServiceAccount_CveSyncTarnwick },
    { id: IntegrationSetting_TarnwickNist, tenantId: Tenant_Tarnwick, source: 'nist', serviceAccountId: ServiceAccount_CveSyncTarnwick },
    { id: IntegrationSetting_TarnwickCisa, tenantId: Tenant_Tarnwick, source: 'cisa', serviceAccountId: ServiceAccount_CveSyncTarnwick },
    { id: IntegrationSetting_TarnwickMicrosoftGraph, tenantId: Tenant_Tarnwick, source: 'microsoft_graph', serviceAccountId: ServiceAccount_CveSyncTarnwick },
    { id: IntegrationSetting_TarnwickOpenaev, tenantId: Tenant_Tarnwick, source: 'openaev', serviceAccountId: ServiceAccount_CveSyncTarnwick },
  ]);
});
