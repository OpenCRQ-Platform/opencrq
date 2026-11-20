import { getSessionCookieName } from '@app/back/src/trpc';
import { authService, createServices } from '@app/module';
import type { createTrpcTestClient } from './trpc-client';
import { db } from '../setup/db';
import { createTestServices } from '../setup/test-context';
import { createPlatformAdmin } from './factories';

type TestClient = ReturnType<typeof createTrpcTestClient>;

/** The tenant `signInAsFirstAdmin` creates, for the tests that read one tenant without creating theirs. */
export const DEFAULT_TENANT_ID = '01a043da-ff47-72c2-aaa4-7da56d85c83e';

const SESSION_MS = 60 * 60_000;

/** Gives the client the session cookie of `userId`, as a sign-in through XTM One leaves it. */
export const signInAs = async (client: TestClient, userId: string): Promise<void> => {
  const sessionId = await createServices([authService], db).withOrigin({ type: 'auth' })
    .auth.createSession(userId, new Date(Date.now() + SESSION_MS));
  client.setCookies([`${getSessionCookieName()}=${sessionId}`]);
};

/**
 * A platform administrator with a tenant of their own, signed in on the client: where most HTTP
 * tests start.
 */
export const signInAsFirstAdmin = async (client: TestClient, { id, email }: { id?: string, email?: string } = {}) => {
  const admin = await createPlatformAdmin(db, { id, email });
  await createTestServices(db).withOrigin({ type: 'platform', userId: admin.userId })
    .tenants.createTenant({ id: DEFAULT_TENANT_ID, name: 'Default' }, admin.userId);
  await signInAs(client, admin.userId);
  return admin;
};
