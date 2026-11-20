import type { AssetCategory, AssetSubcategory } from '@app/module';
import { describe, expect, it } from 'vitest';
import { groupFindingSoftware, mapDefenderOs, mapDeviceCategory, mapDeviceSubcategory, mapExposure } from './graph-mapping-utils';

describe('mapDeviceCategory', () => {
  it.each([
    ['endpoint', '', 'host'],
    ['', 'workstation', 'host'],
    ['', 'laptop', 'host'],
    ['server', '', 'host'],
    ['', 'server', 'host'],
    ['network', '', 'network_device'],
    ['', 'networkdevice', 'network_device'],
    ['', 'firewall', 'network_device'],
    ['iot', '', 'iot_ot_device'],
    ['ot', '', 'iot_ot_device'],
    ['', 'mobiledevice', 'mobile_device'],
  ])('maps category=%s type=%s to %s', (category, type, expected) => {
    expect(mapDeviceCategory(category, type)).toBe(expected);
  });

  it.each([
    ['', 'mobile', 'mobile_device'],
    ['', 'printer', 'iot_ot_device'],
    ['', 'smartappliance', 'iot_ot_device'],
  ])('classifies the Defender type %s%s as %s', (category, type, expected) => {
    expect(mapDeviceCategory(category, type)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(mapDeviceCategory('Server', '')).toBe('host');
    expect(mapDeviceCategory('', 'SmartAppliance')).toBe('iot_ot_device');
  });

  it('resolves an uninterpretable device to generic_asset, never to a house default', () => {
    expect(mapDeviceCategory('', '')).toBe('generic_asset');
    expect(mapDeviceCategory('unknown', 'unknown')).toBe('generic_asset');
  });
});

describe('mapDeviceSubcategory', () => {
  it.each<[string, AssetCategory, AssetSubcategory]>([
    ['Workstation', 'host', 'workstation'],
    ['Laptop', 'host', 'laptop'],
    ['Server', 'host', 'server'],
    ['Firewall', 'network_device', 'firewall'],
    ['Printer', 'iot_ot_device', 'printer_peripheral'],
  ])('maps the Defender type %s under %s to %s', (type, category, expected) => {
    expect(mapDeviceSubcategory(type, category)).toBe(expected);
  });

  it.each<[string, string, AssetCategory, AssetSubcategory]>([
    ['NetworkDevice', 'Switch', 'network_device', 'switch'],
    ['NetworkDevice', 'Router', 'network_device', 'router'],
    ['', 'Streamer', 'iot_ot_device', 'media_device'],
    ['', 'SmartTV', 'iot_ot_device', 'media_device'],
    ['', 'Speaker', 'iot_ot_device', 'media_device'],
    ['MobileDevice', 'Smartphone', 'mobile_device', 'smartphone'],
    ['Printer', 'AllInOne', 'iot_ot_device', 'printer_peripheral'],
    ['NetworkDevice', ' SWITCH ', 'network_device', 'switch'],
  ])('maps the Defender type %s with the subtype %s under %s to %s', (type, subtype, category, expected) => {
    expect(mapDeviceSubcategory(type, category, subtype)).toBe(expected);
  });

  it('lets the subtype win over the type when both name a subcategory of the category', () => {
    expect(mapDeviceSubcategory('Printer', 'iot_ot_device', 'Speaker')).toBe('media_device');
  });

  it.each(['', '   ', 'EbookReader', 'Workstation'])('falls back on the type when the subtype %j names nothing usable', (subtype) => {
    expect(mapDeviceSubcategory('Server', 'host', subtype)).toBe('server');
    expect(mapDeviceSubcategory('Firewall', 'network_device', subtype)).toBe('firewall');
  });

  it('falls back on the type when the subtype is absent', () => {
    expect(mapDeviceSubcategory('Server', 'host', undefined)).toBe('server');
  });

  it('discards a subtype whose subcategory belongs to another category, then tries the type', () => {
    expect(mapDeviceSubcategory('NetworkDevice', 'network_device', 'Smartphone')).toBeNull();
    expect(mapDeviceSubcategory('Firewall', 'network_device', 'Smartphone')).toBe('firewall');
    expect(mapDeviceSubcategory('', 'generic_asset', 'Switch')).toBeNull();
  });

  it('states nothing for a type that names no single subcategory', () => {
    expect(mapDeviceSubcategory('MobileDevice', 'mobile_device')).toBeNull();
    expect(mapDeviceSubcategory('Unknown', 'generic_asset')).toBeNull();
    expect(mapDeviceSubcategory('', 'host')).toBeNull();
  });

  it('drops a subcategory outside the category the device was filed under', () => {
    // DeviceCategory `Endpoint` files a printer as a host, and a printer is not a host subcategory.
    expect(mapDeviceSubcategory('Printer', mapDeviceCategory('Endpoint', 'Printer'))).toBeNull();
  });
});

describe('mapDefenderOs', () => {
  it.each([
    [
      'Windows 11, build and revision appended to 10.0',
      { OSPlatform: 'Windows11', OSDistribution: 'Windows11', OSVersion: '10.0', OSVersionInfo: '25H2', OSBuild: '26200', OsBuildRevision: '9711' },
      { operatingSystem: 'Windows 11 25H2', osVersion: '10.0.26200.9711' },
    ],
    [
      'Windows Server 2019',
      { OSPlatform: 'WindowsServer2019', OSDistribution: 'WindowsServer2019', OSVersion: '10.0', OSVersionInfo: '1809', OSBuild: '17763', OsBuildRevision: '6893' },
      { operatingSystem: 'Windows Server 2019 1809', osVersion: '10.0.17763.6893' },
    ],
    [
      'Windows build without a revision',
      { OSPlatform: 'Windows10', OSDistribution: 'Windows10', OSVersion: '10.0', OSVersionInfo: '22H2', OSBuild: '19045', OsBuildRevision: null },
      { operatingSystem: 'Windows 10 22H2', osVersion: '10.0.19045' },
    ],
    [
      'macOS, the codename alone and the build appended',
      { OSPlatform: 'macOS', OSDistribution: 'macOS', OSVersion: '26.6', OSVersionInfo: 'Tahoe 26.6', OSBuild: '2', OsBuildRevision: null },
      { operatingSystem: 'macOS Tahoe', osVersion: '26.6.2' },
    ],
    [
      'macOS without a build',
      { OSPlatform: 'macOS', OSDistribution: 'macOS', OSVersion: '26.6', OSVersionInfo: 'Tahoe 26.6', OSBuild: null, OsBuildRevision: null },
      { operatingSystem: 'macOS Tahoe', osVersion: '26.6' },
    ],
    [
      'macOS columns that disagree, each taken as given',
      { OSPlatform: 'macOS', OSDistribution: 'macOS', OSVersion: '27.0', OSVersionInfo: 'Tahoe 26.6', OSBuild: null, OsBuildRevision: null },
      { operatingSystem: 'macOS Tahoe', osVersion: '27.0' },
    ],
    [
      'Ubuntu, the version alone even with a build',
      { OSPlatform: 'Linux', OSDistribution: 'Ubuntu', OSVersion: '24.04', OSVersionInfo: '24.04', OSBuild: '3', OsBuildRevision: null },
      { operatingSystem: 'Ubuntu', osVersion: '24.04' },
    ],
    [
      'an undotted version repeated in OSVersionInfo dropped',
      { OSPlatform: 'Linux', OSDistribution: 'Ubuntu', OSVersion: '20', OSVersionInfo: '20', OSBuild: null, OsBuildRevision: null },
      { operatingSystem: 'Ubuntu', osVersion: '20' },
    ],
    [
      'a purely numeric release that is not the version kept',
      { OSPlatform: 'WindowsServer2019', OSDistribution: 'WindowsServer2019', OSVersion: '10.0', OSVersionInfo: '1809', OSBuild: null, OsBuildRevision: null },
      { operatingSystem: 'Windows Server 2019 1809', osVersion: '10.0' },
    ],
    [
      'Red Hat Enterprise Linux spaced out',
      { OSPlatform: 'Linux', OSDistribution: 'RedHatEnterpriseLinux', OSVersion: '9.4', OSVersionInfo: null, OSBuild: null, OsBuildRevision: null },
      { operatingSystem: 'Red Hat Enterprise Linux', osVersion: '9.4' },
    ],
    [
      'no distribution, the platform named instead',
      { OSPlatform: 'Linux', OSDistribution: '', OSVersion: '13.0', OSVersionInfo: null, OSBuild: null, OsBuildRevision: null },
      { operatingSystem: 'Linux', osVersion: '13.0' },
    ],
    [
      'a discovered device reporting a platform and no version',
      { OSPlatform: 'Windows11', OSDistribution: 'Windows11', OSVersion: '', OSVersionInfo: '', OSBuild: null, OsBuildRevision: null },
      { operatingSystem: null, osVersion: null },
    ],
    [
      'a version with neither a distribution nor a platform to name it',
      { OSPlatform: '', OSDistribution: null, OSVersion: '24.04', OSVersionInfo: null, OSBuild: null, OsBuildRevision: null },
      { operatingSystem: null, osVersion: null },
    ],
  ])('%s', (_, row, expected) => {
    expect(mapDefenderOs(row)).toEqual(expected);
  });

  it.each([
    ['SUSELinuxEnterpriseServer', 'SUSE Linux Enterprise Server'],
    ['WindowsServer2012R2', 'Windows Server 2012R2'],
    ['iOS', 'iOS'],
  ])('names the distribution %s as %s', (OSDistribution, expected) => {
    expect(mapDefenderOs({ OSDistribution, OSVersion: '1' }).operatingSystem).toBe(expected);
  });
});

describe('mapExposure', () => {
  it.each([
    ['1', 'internet_facing'],
    ['true', 'internet_facing'],
    ['True', 'internet_facing'],
    ['0', 'internal'],
    ['false', 'internal'],
    ['', 'unknown'],
    ['maybe', 'unknown'],
  ])('maps %s to %s', (raw, expected) => {
    expect(mapExposure(raw)).toBe(expected);
  });
});

describe('groupFindingSoftware', () => {
  const row = (deviceId: string, cveId: string, vendor: string | null, name: string | null, version: string | null) => ({
    DeviceId: deviceId, CveId: cveId, SoftwareVendor: vendor, SoftwareName: name, SoftwareVersion: version,
  });

  it('should fold the versions of one device and CVE into one row', () => {
    const grouped = groupFindingSoftware([
      row('aa11', 'CVE-2026-35189', 'openssl', 'openssl', '3.0.15.0'),
      row('aa11', 'CVE-2026-35189', 'openssl', 'openssl', '4.0.2.0'),
      row('aa11', 'CVE-2026-112992', 'google', 'chrome_for_mac', '155.0.8059.85'),
    ]);

    expect(grouped.map((pair) => [pair.CveId, pair.software])).toEqual([
      ['CVE-2026-35189', [
        { vendor: 'openssl', name: 'openssl', version: '3.0.15.0' },
        { vendor: 'openssl', name: 'openssl', version: '4.0.2.0' },
      ]],
      ['CVE-2026-112992', [{ vendor: 'google', name: 'chrome_for_mac', version: '155.0.8059.85' }]],
    ]);
  });

  it('should keep the pairs of two devices apart', () => {
    const grouped = groupFindingSoftware([
      row('aa11', 'CVE-2026-1', 'google', 'chrome', '1.0'),
      row('bb22', 'CVE-2026-1', 'google', 'chrome', '1.0'),
    ]);

    expect(grouped.map((pair) => pair.DeviceId)).toEqual(['aa11', 'bb22']);
  });

  it('should name a product version once however many rows repeat it', () => {
    const [pair] = groupFindingSoftware([
      row('aa11', 'CVE-2026-1', 'google', 'chrome', '1.0'),
      row('aa11', 'CVE-2026-1', 'google', 'chrome', '1.0'),
    ]);

    expect(pair.software).toHaveLength(1);
  });

  it('should still report a pair whose rows name no software', () => {
    const grouped = groupFindingSoftware([
      row('aa11', 'CVE-2026-1', 'google', null, '1.0'),
      row('aa11', 'CVE-2026-1', null, null, null),
    ]);

    expect(grouped).toEqual([expect.objectContaining({ DeviceId: 'aa11', CveId: 'CVE-2026-1', software: [] })]);
  });
});
