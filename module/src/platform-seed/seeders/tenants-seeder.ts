import { and, eq } from 'drizzle-orm';
import { tenantUsers } from '../../modules/tenants/schema';
import {
  Tenant_Acme,
  Tenant_FreshStart,
  Tenant_Tarnwick,
  User_Alice,
  User_Bob,
  User_Charlie,
  User_Eve,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('tenants', async ({ db, services, state }) => {
  if (!state.adminUserId) {
    throw new Error('[platform-seed] tenants seeder requires adminUserId — users seeder must run first');
  }
  const systemServices = services.withOrigin({ type: 'system' });

  await systemServices.tenants.createTenant({ id: Tenant_Acme, name: 'Acme Bank' }, state.adminUserId);

  await db.insert(tenantUsers).values([
    { tenantId: Tenant_Acme, userId: User_Alice },
    { tenantId: Tenant_Acme, userId: User_Bob },
    { tenantId: Tenant_Acme, userId: User_Charlie },
  ]);

  // Per-tenant profile overrides (Discord-style)
  await db.update(tenantUsers)
    .set({ title: 'Lead Security Analyst' })
    .where(and(eq(tenantUsers.tenantId, Tenant_Acme), eq(tenantUsers.userId, User_Alice)));
  await db.update(tenantUsers)
    .set({ name: 'Robert Johnson' })
    .where(and(eq(tenantUsers.tenantId, Tenant_Acme), eq(tenantUsers.userId, User_Bob)));

  await systemServices.tenants.createTenant({ id: Tenant_Tarnwick, name: 'Tarnwick Industries' }, state.adminUserId);

  await db.insert(tenantUsers).values({ tenantId: Tenant_Tarnwick, userId: User_Eve });

  // Born as a tenant created from the platform administration: its first risk scope and its Get started
  // wizard, nothing else, so the first-login flow and the Get started drawers render on a seeded platform.
  await systemServices.tenants.createTenant({ id: Tenant_FreshStart, name: 'Fresh Start' }, state.adminUserId, { provisionOnboarding: true });
});
