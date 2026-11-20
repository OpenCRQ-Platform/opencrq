import { organizations } from '../../modules/organizations/schema';
import { acmeOrganizations, tarnwickOrganizations } from '../data/organizations';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('organizations', async ({ db }) => {
  await db.insert(organizations).values(acmeOrganizations);

  await db.insert(organizations).values(tarnwickOrganizations);
});
