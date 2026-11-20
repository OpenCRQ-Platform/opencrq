import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrizzleDB } from '@app/module';
import { issueTestXtmLicense, xtmLicenseExtensions } from './xtm-license-fixtures';

// The rule is exercised against a CA of the test's own, standing in for the pinned one.
const ca = await vi.hoisted(async () => {
  const fixtures = await import('./xtm-license-fixtures');
  return fixtures.createTestXtmCa();
});
vi.mock('./xtm-ca', () => ({ XTM_CA_PEM: ca.certificatePem }));

const PLATFORM_ID = '0199a3c1-7b2e-7c4d-9f10-4e5a6b7c8d9e';
const OTHER_PLATFORM_ID = '0199a3c1-7b2e-7c4d-9f10-000000000000';
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const DAY = 24 * 60 * 60_000;

vi.mock('./edition-instance', () => ({
  ensureInstance: () => Promise.resolve({ instanceId: PLATFORM_ID, createdAt: NOW - DAY }),
}));
vi.mock('@app/module', () => ({ schema: { platformMetadata: { key: 'key' } } }));
vi.mock('drizzle-orm', () => ({ eq: (_column: unknown, value: string) => ({ value }) }));
const publishRemoteEntitlement = vi.fn();
vi.mock('./entitlement-ipc', () => ({
  publishRemoteEntitlement: (...args: Array<unknown>) => publishRemoteEntitlement(...args),
}));

const editionLicense = await import('./edition-license');
const {
  describeInstalledFiligranLicense,
  FILIGRAN_LICENSE_METADATA_KEY,
  loadInstalledFiligranLicense,
  removeFiligranLicense,
} = editionLicense;
const {
  getEditionLicenseSource,
  getLicenseExpiry,
  isEditionResolutionPending,
  isEnterpriseEdition,
  beginEditionResolution,
  resetEditionState,
  setRemoteEntitlementExpiry,
} = await import('./edition-state');

/** The `platform_metadata` table, key to value, behind the few query shapes the module uses. */
const createMetadataDb = (rows: Map<string, string>): DrizzleDB => {
  const db = {
    select: () => ({
      from: () => ({
        where: ({ value }: { value: string }) => Promise.resolve(rows.has(value) ? [{ key: value, value: rows.get(value) }] : []),
      }),
    }),
    delete: () => ({
      where: ({ value }: { value: string }) => {
        rows.delete(value);
        return Promise.resolve();
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the query shapes edition-license.ts uses are needed here
  return db as unknown as DrizzleDB;
};

const filigranLicense = (opencrqIds: ReadonlyArray<string> = ['global']): string => issueTestXtmLicense(ca, {
  notBefore: NOW - DAY,
  notAfter: NOW + 365 * DAY,
  extensions: xtmLicenseExtensions({ opencrqIds }),
});

describe('the installed Filigran license', () => {
  let rows: Map<string, string>;
  let db: DrizzleDB;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    rows = new Map();
    db = createMetadataDb(rows);
    publishRemoteEntitlement.mockClear();
  });

  afterEach(() => {
    resetEditionState();
    vi.useRealTimers();
  });

  // Filigran License v2 (17 Nov 2026): OpenCRQ takes its license from XTM One only.
  it('offers no way to install a Filigran license on the instance', () => {
    expect(Object.keys(editionLicense)).not.toContain('installFiligranLicense');
  });

  it('keeps a license installed before entitling the platform at boot, as a local grant', async () => {
    const pem = filigranLicense();
    rows.set(FILIGRAN_LICENSE_METADATA_KEY, pem);

    const verdict = await loadInstalledFiligranLicense(db);

    expect(verdict).toEqual({ entitled: true, entitledUntil: NOW + 455 * DAY, expiresAt: NOW + 365 * DAY, type: 'standard' });
    expect(isEnterpriseEdition()).toBe(true);
    expect(getEditionLicenseSource()).toBe('local');
    expect(getLicenseExpiry()).toBe(NOW + 365 * DAY);
    expect(publishRemoteEntitlement).not.toHaveBeenCalled();
  });

  it('keeps one naming this platform by its instance id entitling', async () => {
    rows.set(FILIGRAN_LICENSE_METADATA_KEY, filigranLicense([OTHER_PLATFORM_ID, PLATFORM_ID]));
    await expect(loadInstalledFiligranLicense(db)).resolves.toMatchObject({ entitled: true });
  });

  it('grants nothing from one naming another platform id, or with its OpenCRQ module unchecked', async () => {
    rows.set(FILIGRAN_LICENSE_METADATA_KEY, filigranLicense([OTHER_PLATFORM_ID]));
    await expect(loadInstalledFiligranLicense(db)).resolves.toMatchObject({
      entitled: false,
      reason: `it neither sub-licenses this platform (${PLATFORM_ID}) nor every platform ("global")`,
    });
    expect(isEnterpriseEdition()).toBe(false);

    rows.set(FILIGRAN_LICENSE_METADATA_KEY, filigranLicense([]));
    await expect(loadInstalledFiligranLicense(db)).resolves.toMatchObject({ entitled: false });
    expect(isEnterpriseEdition()).toBe(false);
  });

  it('grants nothing from one an untrusted CA signed', async () => {
    const { createTestXtmCa } = await import('./xtm-license-fixtures');
    rows.set(FILIGRAN_LICENSE_METADATA_KEY, issueTestXtmLicense(createTestXtmCa('Forged CA'), {
      notBefore: NOW - DAY,
      notAfter: NOW + 365 * DAY,
      extensions: xtmLicenseExtensions(),
    }));

    await expect(loadInstalledFiligranLicense(db)).resolves.toMatchObject({ entitled: false, signed: false });
  });

  it('revokes the local grant on removal and leaves XTM One\'s grant alone', async () => {
    setRemoteEntitlementExpiry(NOW + DAY, NOW + 30 * DAY);
    rows.set(FILIGRAN_LICENSE_METADATA_KEY, filigranLicense());
    await loadInstalledFiligranLicense(db);

    await removeFiligranLicense(db);

    expect(rows.has(FILIGRAN_LICENSE_METADATA_KEY)).toBe(false);
    expect(publishRemoteEntitlement).toHaveBeenLastCalledWith({ expiresAt: 0, licenseExpiresAt: null, licenseType: null, slot: 'local' });
    expect(isEnterpriseEdition()).toBe(true);
    expect(getEditionLicenseSource()).toBe('remote');
    vi.advanceTimersByTime(DAY);
    expect(isEnterpriseEdition()).toBe(false);
  });

  it('grants nothing at boot when none is installed', async () => {
    await expect(loadInstalledFiligranLicense(db)).resolves.toBeNull();
    expect(isEnterpriseEdition()).toBe(false);
  });

  it('does not settle the XTM One resolution the gates wait for', async () => {
    beginEditionResolution();
    rows.set(FILIGRAN_LICENSE_METADATA_KEY, filigranLicense());

    await loadInstalledFiligranLicense(db);

    expect(isEditionResolutionPending()).toBe(true);
  });

  it('is described to the administrator, with the reason when it no longer entitles', async () => {
    await expect(describeInstalledFiligranLicense(db)).resolves.toBeNull();

    rows.set(FILIGRAN_LICENSE_METADATA_KEY, filigranLicense());
    await expect(describeInstalledFiligranLicense(db)).resolves.toEqual({ entitled: true, reason: null, expiresAt: NOW + 365 * DAY, type: 'standard' });

    vi.advanceTimersByTime(456 * DAY);
    await expect(describeInstalledFiligranLicense(db)).resolves.toMatchObject({ entitled: false, expiresAt: null });
  });
});
