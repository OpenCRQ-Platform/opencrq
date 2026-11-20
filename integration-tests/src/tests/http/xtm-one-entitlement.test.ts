import { issueTestXtmLicense, xtmLicenseExtensions } from '@app/back/src/features/edition/xtm-license-fixtures';
import type { TestXtmCa } from '@app/back/src/features/edition/xtm-license-fixtures';
import { getEntitlementRefusal, registerWithXtmOne } from '@app/back/src/features/xtm-one/xtm-one-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeXtmOne } from '../../helpers/fake-xtm-one';
import { startFakeXtmOne } from '../../helpers/fake-xtm-one';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { setTestEdition } from '../../setup/create-test-app';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

// Licenses are signed by a CA of the test's own, standing in for the XTM CA pinned in the build.
const ca = await vi.hoisted(async () => {
  const fixtures = await import('@app/back/src/features/edition/xtm-license-fixtures');
  return { signer: fixtures.createTestXtmCa(), forger: fixtures.createTestXtmCa('Forger') };
});
vi.mock('../../../../back/src/features/edition/xtm-ca', () => ({ XTM_CA_PEM: ca.signer.certificatePem }));

const DAY = 24 * 60 * 60_000;

const licenseFor = (opencrqIds: Array<string>, signer: TestXtmCa = ca.signer): string => issueTestXtmLicense(signer, {
  notBefore: Date.now() - DAY,
  notAfter: Date.now() + 30 * DAY,
  extensions: xtmLicenseExtensions({ opencrqIds }),
});

// Everything but the pinned trust anchor is real: the socket, the answer parsing, the instance
// identity in the database and the edition the bootstrap payload reports.
describe('Enterprise Edition from the XTM One registration (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let xtmOne: FakeXtmOne | undefined;

  const registerAgainst = async (answer: (platformId: string) => unknown) => {
    await xtmOne?.close();
    xtmOne = await startFakeXtmOne(answer);
    const result = await registerWithXtmOne({ url: xtmOne.url, token: 'registration-token', platformUrl: 'https://opencrq.test' }, db);
    // The answer arrived and parsed: an edition left at its default would prove nothing.
    expect(result).not.toBeNull();
  };

  const edition = async (): Promise<unknown> => (await client.query('authStatus')).json.result.data.edition;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    setTestEdition('ce');
    client = createTrpcTestClient(server);
  });

  afterEach(async () => {
    await xtmOne?.close();
    xtmOne = undefined;
  });

  it('should stay in Community Edition when XTM One answers ee_enabled without a license', async () => {
    await registerAgainst(() => ({ status: 'active', platform_identifier: 'opencrq', ee_enabled: true, user_integrations: 1, version: '1.260917.0' }));

    expect(await edition()).toBe('ce');
  });

  it('should name the default registration token when XTM One withholds the license for it', async () => {
    await registerAgainst(() => ({
      status: 'active',
      ee_enabled: true,
      ee_sources: ['xtm_sublicense'],
      xtm_license_withheld_reason: 'registration_token_published_default',
    }));

    expect(await edition()).toBe('ce');
    expect(getEntitlementRefusal()).toBe('license_withheld_default_token');
  });

  it('should grant Enterprise Edition from a license the XTM CA signed for this platform', async () => {
    await registerAgainst((platformId) => ({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: licenseFor([platformId]) }));

    expect(await edition()).toBe('ee');
  });

  it('should refuse a license that sub-licenses another platform', async () => {
    await registerAgainst(() => ({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: licenseFor(['another-platform']) }));

    expect(await edition()).toBe('ce');
    expect(getEntitlementRefusal()).toBe('license_invalid');
  });

  it('should refuse a license another CA signed', async () => {
    await registerAgainst(() => ({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: licenseFor(['global'], ca.forger) }));

    expect(await edition()).toBe('ce');
    expect(getEntitlementRefusal()).toBe('license_untrusted');
  });

  it('should end Enterprise Edition on the first heartbeat whose answer proves nothing', async () => {
    await registerAgainst((platformId) => ({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: licenseFor([platformId]) }));
    expect(await edition()).toBe('ee');

    await registerAgainst(() => ({ status: 'active', ee_enabled: true }));

    expect(await edition()).toBe('ce');
  });
});
