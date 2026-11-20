import { issueTestXtmLicense, xtmLicenseExtensions } from '@app/back/src/features/edition/xtm-license-fixtures';
import { editionRouter } from '@app/back/src/features/edition/edition-router';
import { provideRegistrationRun, serializeRuns } from '@app/back/src/features/xtm-one/xtm-one-check';
import { registerWithXtmOne } from '@app/back/src/features/xtm-one/xtm-one-client';
import { resetXtmOneReachability } from '@app/back/src/features/xtm-one/xtm-one-reachability';
import { protectedProcedure } from '@app/back/src/trpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeXtmOne } from '../../helpers/fake-xtm-one';
import { startFakeXtmOne } from '../../helpers/fake-xtm-one';
import { createAdminUser, createUser } from '../../helpers/factories';
import { setTestEdition } from '../../setup/create-test-app';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// Licenses are signed by a CA of the test's own, standing in for the XTM CA pinned in the build.
const ca = await vi.hoisted(async () => {
  const fixtures = await import('@app/back/src/features/edition/xtm-license-fixtures');
  return { signer: fixtures.createTestXtmCa() };
});
vi.mock('../../../../back/src/features/edition/xtm-ca', () => ({ XTM_CA_PEM: ca.signer.certificatePem }));

const DAY = 24 * 60 * 60_000;

const licenseFor = (platformId: string): string => issueTestXtmLicense(ca.signer, {
  notBefore: Date.now() - DAY,
  notAfter: Date.now() + 30 * DAY,
  extensions: xtmLicenseExtensions({ opencrqIds: [platformId] }),
});

const services = createTestServices(db);

// The edition router is mounted by the HTTP engine, outside the test app: called directly, it still
// runs the real platform capability gate, the real registration and the real edition state.
const callerFor = (userId: string) => editionRouter(protectedProcedure, db).createCaller(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the fields the auth middleware reads are needed here
  { user: { id: userId }, session: { id: 'session-1' }, tenantId: undefined, serviceAccount: null } as never,
);

const wireXtmOne = (url: string): void => {
  provideRegistrationRun(serializeRuns(async () => {
    await registerWithXtmOne({ url, token: 'registration-token', platformUrl: 'https://opencrq.test' }, db);
  }));
};

describe('Checking the Enterprise Edition with XTM One on demand (tRPC)', () => {
  let xtmOne: FakeXtmOne | undefined;
  let adminId: string;

  const answering = async (answer: (platformId: string) => unknown, options?: { status?: number }) => {
    await xtmOne?.close();
    xtmOne = await startFakeXtmOne(answer, options);
    wireXtmOne(xtmOne.url);
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    setTestEdition('ce');
    resetXtmOneReachability();
    adminId = (await createAdminUser(services)).userId;
  });

  afterEach(async () => {
    provideRegistrationRun(null);
    await xtmOne?.close();
    xtmOne = undefined;
  });

  it('should refuse a user without the MANAGE_USERS platform capability', async () => {
    await answering(() => ({ status: 'active' }));
    const { userId } = await createUser(db);

    await expect(callerFor(userId).checkWithXtmOne()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(xtmOne?.requests).toHaveLength(0);
  });

  it('should refuse a check where no XTM One is configured', async () => {
    await expect(callerFor(adminId).checkWithXtmOne()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('should switch to Enterprise Edition as soon as XTM One returns a license, without waiting for the heartbeat', async () => {
    await answering((platformId) => ({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: licenseFor(platformId) }));
    const caller = callerFor(adminId);
    expect((await caller.getStatus()).edition).toBe('ce');

    const check = await caller.checkWithXtmOne();

    expect(check).toMatchObject({ registration: 'ok', failingSince: null, lastAnsweredAt: expect.any(Date) });
    expect((await caller.getStatus()).edition).toBe('ee');
  });

  it('should report a refused registration right after a success, which the reachability still calls ok', async () => {
    await answering(() => ({ status: 'active' }));
    const caller = callerFor(adminId);
    const answered = await caller.checkWithXtmOne();

    await answering(() => ({ detail: 'Invalid registration token' }), { status: 401 });
    const refused = await caller.checkWithXtmOne();

    expect(refused).toMatchObject({ registration: 'refused', failingSince: expect.any(Date), lastAnsweredAt: answered.lastAnsweredAt });
  });

  it('should report an XTM One it cannot reach', async () => {
    await answering(() => ({ status: 'active' }));
    const unreachable = xtmOne?.url ?? '';
    await xtmOne?.close();
    xtmOne = undefined;
    wireXtmOne(unreachable);

    await expect(callerFor(adminId).checkWithXtmOne()).resolves.toMatchObject({ registration: 'unreachable', lastAnsweredAt: null });
  });
});
