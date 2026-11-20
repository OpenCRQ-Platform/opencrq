import { declaredEstate, declaredEstateEvents } from '../../modules/declared-estate/schema';
import { acmeCorpDeclaredEstate } from '../data/declared-estate';
import { declaredEstateEventId, Organization_AcmeCorp, Tenant_Acme, User_Admin } from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('declared-estate', async ({ db, now }) => {
  await db.insert(declaredEstate).values(acmeCorpDeclaredEstate.map((answer) => ({
    ...answer,
    tenantId: Tenant_Acme,
    organizationId: Organization_AcmeCorp,
    setByUserId: User_Admin,
    setAt: now,
  })));
  await db.insert(declaredEstateEvents).values(acmeCorpDeclaredEstate.map((answer, index) => ({
    id: declaredEstateEventId(index),
    tenantId: Tenant_Acme,
    organizationId: Organization_AcmeCorp,
    kind: answer.kind,
    userId: User_Admin,
    newLow: answer.low,
    newHigh: answer.high,
    newInternetFacing: answer.internetFacing,
    createdAt: now,
  })));
});
