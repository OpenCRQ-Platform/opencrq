import { parseThreatBundle } from '../../modules/threat-analyses/stix-bundle-parser';
import { buildAcmeThreatBundle } from '../data/acme-threat-bundle';
import { acmeSeedOutcomeCounter } from '../data/acme-threat-outcome-probabilities';
import { Tenant_Acme, User_Admin } from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

// Client origin (not system): ingestBundle upserts CVE catalog shells through cveService,
// which requires a tenant-carrying origin.
const acmeAdminOrigin = { type: 'client', userId: User_Admin, tenantId: Tenant_Acme } as const;

// The demo actors take the door an uploaded bundle takes: generated as STIX, read by the import
// parser, ingested as `stix-import`, so nothing distinguishes them from a customer's own import. Only
// their outcome percentages come stored, so the seed never loads the model.
registerPlatformSeed('threats', async ({ services, now }) => {
  const parsed = parseThreatBundle(buildAcmeThreatBundle(now));
  await services
    .withOrigin(acmeAdminOrigin)
    .threatAnalyses.ingestBundle(parsed, Tenant_Acme, 'stix-import', { counter: acmeSeedOutcomeCounter });
});
