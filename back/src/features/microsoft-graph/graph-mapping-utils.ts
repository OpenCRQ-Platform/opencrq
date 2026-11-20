import type { AssetCategory, AssetSubcategory, ReportedSoftware, SupportingAssetExposure } from '@app/module';
import { SUBCATEGORY_TO_CATEGORY } from '@app/module';

export const mapDeviceCategory = (deviceCategory: string, deviceType: string): AssetCategory => {
  const cat = deviceCategory.toLowerCase();
  const type = deviceType.toLowerCase();
  if (cat === 'endpoint' || type === 'workstation' || type === 'laptop') {
    return 'host';
  }
  if (cat === 'server' || type === 'server') {
    return 'host';
  }
  if (cat === 'network' || type === 'networkdevice' || type === 'firewall') {
    return 'network_device';
  }
  if (cat === 'iot' || cat === 'ot' || type === 'printer' || type === 'smartappliance') {
    return 'iot_ot_device';
  }
  if (type === 'mobiledevice' || type === 'mobile') {
    return 'mobile_device';
  }
  return 'generic_asset'; // the connector states it cannot classify rather than guessing
};

const DEVICE_TYPE_SUBCATEGORY: Readonly<Record<string, AssetSubcategory>> = {
  workstation: 'workstation',
  laptop: 'laptop',
  server: 'server',
  firewall: 'firewall',
  printer: 'printer_peripheral',
};

// Defender's `DeviceSubtype` vocabulary as observed on a tenant; anything else maps to nothing.
const DEVICE_SUBTYPE_SUBCATEGORY: Readonly<Record<string, AssetSubcategory>> = {
  switch: 'switch',
  router: 'router',
  streamer: 'media_device',
  smarttv: 'media_device',
  speaker: 'media_device',
  smartphone: 'smartphone',
  allinone: 'printer_peripheral',
};

/**
 * `DeviceSubtype`, then `DeviceType`, onto a subcategory, only where the vendor's word names one
 * outright. Defender files a laptop under `Workstation`, so it reads `workstation`; a mobile device
 * states a subcategory only when its subtype does (a phone), never from its type. A subcategory
 * outside the category `mapDeviceCategory` chose is dropped, since `DeviceCategory` can override the
 * type there; the type is then tried before giving up.
 */
export const mapDeviceSubcategory = (
  deviceType: string,
  categoryId: AssetCategory,
  deviceSubtype?: string | null,
): AssetSubcategory | null => {
  const candidates = [
    DEVICE_SUBTYPE_SUBCATEGORY[(deviceSubtype ?? '').trim().toLowerCase()],
    DEVICE_TYPE_SUBCATEGORY[deviceType.trim().toLowerCase()],
  ];
  return candidates.find((subcategoryId) => subcategoryId !== undefined && SUBCATEGORY_TO_CATEGORY[subcategoryId] === categoryId) ?? null;
};

/**
 * `IdentityInfo.Type` onto the six identity subcategories the shared taxonomy carries. The
 * reference tenant serves only `User` and `ServiceAccount`; the rest are the vocabulary Defender
 * documents and are mapped rather than waited for.
 *
 * An unrecognised type resolves to `null` instead of a default: the raw value is kept in
 * `directoryType`, so a vocabulary this map does not know is visible on the asset rather than
 * filed under a guess.
 */
export const mapIdentitySubcategory = (identityType: string): AssetSubcategory | null => {
  switch (identityType.trim().toLowerCase()) {
    case 'user':
      return 'user_account';
    case 'serviceaccount':
      return 'service_account';
    // A service principal and a managed identity are both an application's identity, which is the
    // distinction the subcategory carries; which of the two it is stays in `directoryType`.
    case 'serviceprincipal':
    case 'managedidentity':
      return 'non_human_identity';
    case 'group':
      return 'group';
    case 'role':
      return 'role';
    case 'sharedmailbox':
    case 'mailbox':
      return 'shared_mailbox';
    default:
      return null;
  }
};

export interface DefenderOsColumns {
  OSPlatform?: string | null,
  OSDistribution?: string | null,
  OSVersion?: string | null,
  OSVersionInfo?: string | null,
  OSBuild?: string | null,
  OsBuildRevision?: string | null,
}

const present = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** `Windows11` → `Windows 11`, `RedHatEnterpriseLinux` → `Red Hat Enterprise Linux`, while `macOS` and `2012R2` stay whole. */
const spaceOut = (word: string): string => word
  .replaceAll(/([a-z])([A-Z][a-z])/g, '$1 $2')
  .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .replaceAll(/([a-z])(\d)/g, '$1 $2');

const isDottedNumber = (token: string): boolean => /^\d+(\.\d+)+$/.test(token);

/**
 * `OSVersion` reads `10.0` on every Windows device, hence the build and revision appended there (the
 * build alone on macOS). `OSVersionInfo` repeats the version on macOS (`Tahoe 26.6`), which is
 * dropped. No version, as on a device Defender only discovered, or no OS name means neither field.
 */
export const mapDefenderOs = (row: DefenderOsColumns): { operatingSystem: string | null, osVersion: string | null } => {
  const baseVersion = present(row.OSVersion);
  const distribution = present(row.OSDistribution) ?? present(row.OSPlatform);
  if (baseVersion === null || distribution === null) {
    return { operatingSystem: null, osVersion: null };
  }
  const platform = (present(row.OSPlatform) ?? '').toLowerCase();
  const build = present(row.OSBuild);
  const revision = present(row.OsBuildRevision);
  let osVersion = baseVersion;
  if (platform.startsWith('windows') && build !== null) {
    osVersion = [baseVersion, build, ...(revision === null ? [] : [revision])].join('.');
  } else if (platform.startsWith('macos') && build !== null) {
    osVersion = `${baseVersion}.${build}`;
  }

  const release = (present(row.OSVersionInfo) ?? '').split(/\s+/)
    .filter((token) => token !== '' && token !== baseVersion && !isDottedNumber(token));
  return { operatingSystem: [spaceOut(distribution), ...release].join(' '), osVersion };
};

export const mapExposure = (isInternetFacing: string): SupportingAssetExposure => {
  if (isInternetFacing === '1' || isInternetFacing.toLowerCase() === 'true') {
    return 'internet_facing';
  }
  if (isInternetFacing === '0' || isInternetFacing.toLowerCase() === 'false') {
    return 'internal';
  }
  return 'unknown';
};

interface FindingSoftwareRow {
  DeviceId: string,
  CveId: string,
  SoftwareVendor: string | null,
  SoftwareName: string | null,
  SoftwareVersion: string | null,
}

/** The first row of a device and CVE stands for the pair, and a row naming no software still reports it. */
export const groupFindingSoftware = <Row extends FindingSoftwareRow>(rows: ReadonlyArray<Row>): Array<Row & { software: Array<ReportedSoftware> }> => {
  const pairs = new Map<string, { row: Row, software: Map<string, ReportedSoftware> }>();
  for (const row of rows) {
    const pairKey = JSON.stringify([row.DeviceId, row.CveId]);
    const pair = pairs.get(pairKey) ?? { row, software: new Map<string, ReportedSoftware>() };
    pairs.set(pairKey, pair);
    if (row.SoftwareName !== null && row.SoftwareVersion !== null) {
      const entry = { vendor: row.SoftwareVendor, name: row.SoftwareName, version: row.SoftwareVersion };
      pair.software.set(JSON.stringify([entry.vendor, entry.name, entry.version]), entry);
    }
  }
  return [...pairs.values()].map(({ row, software }) => ({ ...row, software: [...software.values()] }));
};
