import { financialProfiles } from '../../modules/financial-profiles/schema';
import { acmeCorpFinancialProfile } from '../data/financial-profiles';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('financial-profiles', async ({ db, now }) => {
  // The seed ships these answers' derived amounts too, so the profile is born in step with them.
  // Left unstamped it would open on a recompute notice no automatic pass ever clears.
  const seededAt = now;
  await db.insert(financialProfiles).values([{ ...acmeCorpFinancialProfile, updatedAt: seededAt }]);
});
