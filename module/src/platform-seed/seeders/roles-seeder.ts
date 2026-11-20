import { Capability_ManageSecurity } from '../../modules/capabilities/data/capabilities-ids';
import { roleCapabilities, roles } from '../../modules/roles/schema';
import { Role_SecurityAnalyst, Role_Viewer, Tenant_Acme } from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('roles', async ({ db }) => {
  await db.insert(roles).values({ id: Role_SecurityAnalyst, name: 'Security Analyst', tenantId: Tenant_Acme });
  await db.insert(roleCapabilities).values({ roleId: Role_SecurityAnalyst, capabilityId: Capability_ManageSecurity });

  // Viewer role — no capabilities (read-only via default tenant membership)
  await db.insert(roles).values({ id: Role_Viewer, name: 'Viewer', tenantId: Tenant_Acme });
});
