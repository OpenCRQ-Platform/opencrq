import { describe, expect, it } from 'vitest';
import type { EntryAsset, UnknownExposureCountsAs } from './entry-applicability';
import {
  countedExposure,
  entryTechniqueApplies,
  isEffectivelyExposed,
  isInitialAccessTechnique,
  isPlayedAtInitialAccess,
  needsExposureOutsidePerimeter,
  UNKNOWN_EXPOSURE_COUNTS_AS_VALUES,
} from './entry-applicability';

const asset = (overrides: Partial<EntryAsset>): EntryAsset => ({
  categoryId: 'host',
  subcategoryId: null,
  exposure: 'internal',
  identityEnabled: true,
  ...overrides,
});

const applies = (technique: string, entry: EntryAsset, setting: UnknownExposureCountsAs = 'internal'): boolean =>
  entryTechniqueApplies(technique, entry, setting);

describe('UNKNOWN_EXPOSURE_COUNTS_AS_VALUES', () => {
  it('lists the two readings a setting can give an unknown exposure', () => {
    expect(UNKNOWN_EXPOSURE_COUNTS_AS_VALUES).toEqual(['internal', 'internet_facing']);
  });
});

describe('entryTechniqueApplies, T1190 and T1133', () => {
  it.each(['T1190', 'T1133'])('%s applies to an internet-facing asset of any family', (technique) => {
    expect(applies(technique, asset({ exposure: 'internet_facing' }))).toBe(true);
    expect(applies(technique, asset({ categoryId: 'web_application', subcategoryId: 'website', exposure: 'internet_facing' }))).toBe(true);
    expect(applies(technique, asset({ categoryId: 'network_device', subcategoryId: 'vpn_gateway', exposure: 'internet_facing' }))).toBe(true);
  });

  it.each(['T1190', 'T1133'])('%s applies to an exposed generic asset', (technique) => {
    expect(applies(technique, asset({ categoryId: 'generic_asset', subcategoryId: null, exposure: 'internet_facing' }))).toBe(true);
  });

  it.each(['T1190', 'T1133'])('%s never applies to an internal asset, whatever the setting', (technique) => {
    expect(applies(technique, asset({ exposure: 'internal' }), 'internal')).toBe(false);
    expect(applies(technique, asset({ exposure: 'internal' }), 'internet_facing')).toBe(false);
  });

  it.each(['T1190', 'T1133'])('%s follows the setting for an unknown exposure', (technique) => {
    expect(applies(technique, asset({ exposure: 'unknown' }), 'internal')).toBe(false);
    expect(applies(technique, asset({ exposure: 'unknown' }), 'internet_facing')).toBe(true);
  });

  it('follows its parent technique for a sub-technique', () => {
    expect(applies('T1133.001', asset({ exposure: 'internet_facing' }))).toBe(true);
    expect(applies('T1190.001', asset({ exposure: 'internal' }))).toBe(false);
  });
});

describe('entryTechniqueApplies, T1566 and T1189', () => {
  it.each(['T1566', 'T1189'])('%s applies to a workstation, a laptop and a host without subcategory', (technique) => {
    expect(applies(technique, asset({ subcategoryId: 'workstation' }))).toBe(true);
    expect(applies(technique, asset({ subcategoryId: 'laptop' }))).toBe(true);
    expect(applies(technique, asset({ subcategoryId: null }))).toBe(true);
  });

  it.each(['T1566', 'T1189'])('%s applies to a workstation whatever its exposure and the setting', (technique) => {
    for (const exposure of ['internal', 'internet_facing', 'unknown'] as const) {
      expect(applies(technique, asset({ subcategoryId: 'workstation', exposure }), 'internal')).toBe(true);
      expect(applies(technique, asset({ subcategoryId: 'workstation', exposure }), 'internet_facing')).toBe(true);
    }
  });

  it.each(['T1566', 'T1189'])('%s never applies to a server, a virtual machine, a hypervisor, a mainframe or a thin client', (technique) => {
    for (const subcategoryId of ['server', 'virtual_machine', 'hypervisor', 'mainframe', 'thin_client'] as const) {
      expect(applies(technique, asset({ subcategoryId, exposure: 'internet_facing' }))).toBe(false);
    }
  });

  it.each(['T1566', 'T1189'])('%s applies to the mobile device family', (technique) => {
    expect(applies(technique, asset({ categoryId: 'mobile_device', subcategoryId: 'smartphone' }))).toBe(true);
    expect(applies(technique, asset({ categoryId: 'mobile_device', subcategoryId: null }))).toBe(true);
  });

  it.each(['T1566', 'T1189'])('%s applies to an enabled user account only', (technique) => {
    expect(applies(technique, asset({ categoryId: 'identity', subcategoryId: 'user_account' }))).toBe(true);
    expect(applies(technique, asset({ categoryId: 'identity', subcategoryId: 'user_account', identityEnabled: false }))).toBe(false);
    expect(applies(technique, asset({ categoryId: 'identity', subcategoryId: 'service_account' }))).toBe(false);
  });

  it.each(['T1566', 'T1189'])('%s never applies to a generic asset, even exposed', (technique) => {
    expect(applies(technique, asset({ categoryId: 'generic_asset', subcategoryId: null, exposure: 'internet_facing' }))).toBe(false);
  });

  it.each(['T1566', 'T1189'])('%s does not apply to families that no user sits behind', (technique) => {
    expect(applies(technique, asset({ categoryId: 'web_application', subcategoryId: 'website' }))).toBe(false);
    expect(applies(technique, asset({ categoryId: 'network_device', subcategoryId: 'router' }))).toBe(false);
    expect(applies(technique, asset({ categoryId: 'cloud_resource', subcategoryId: 'compute' }))).toBe(false);
  });

  it('follows its parent technique for a sub-technique', () => {
    expect(applies('T1566.002', asset({ subcategoryId: 'laptop' }))).toBe(true);
    expect(applies('T1566.002', asset({ subcategoryId: 'server' }))).toBe(false);
    expect(applies('T1189.001', asset({ categoryId: 'generic_asset', subcategoryId: null }))).toBe(false);
  });
});

describe('entryTechniqueApplies, T1078', () => {
  it('applies to an enabled user account, service account and non-human identity', () => {
    for (const subcategoryId of ['user_account', 'service_account', 'non_human_identity'] as const) {
      expect(applies('T1078', asset({ categoryId: 'identity', subcategoryId }))).toBe(true);
    }
  });

  it('applies to a cloud IAM principal', () => {
    expect(applies('T1078', asset({ categoryId: 'cloud_resource', subcategoryId: 'iam_principal' }))).toBe(true);
  });

  it('never applies to a disabled identity', () => {
    for (const subcategoryId of ['user_account', 'service_account', 'non_human_identity'] as const) {
      expect(applies('T1078', asset({ categoryId: 'identity', subcategoryId, identityEnabled: false }))).toBe(false);
    }
  });

  it('never applies to a group, a role or a shared mailbox', () => {
    for (const subcategoryId of ['group', 'role', 'shared_mailbox'] as const) {
      expect(applies('T1078', asset({ categoryId: 'identity', subcategoryId }))).toBe(false);
    }
  });

  it('never applies to an identity without subcategory or to another cloud resource', () => {
    expect(applies('T1078', asset({ categoryId: 'identity', subcategoryId: null }))).toBe(false);
    expect(applies('T1078', asset({ categoryId: 'cloud_resource', subcategoryId: 'compute' }))).toBe(false);
  });

  it('does not depend on the exposure', () => {
    for (const exposure of ['internal', 'internet_facing', 'unknown'] as const) {
      expect(applies('T1078', asset({ categoryId: 'identity', subcategoryId: 'user_account', exposure }))).toBe(true);
    }
  });

  it('does not apply to a host', () => {
    expect(applies('T1078', asset({ categoryId: 'host', subcategoryId: 'workstation', exposure: 'internet_facing' }))).toBe(false);
  });

  it('follows its parent technique for a sub-technique', () => {
    expect(applies('T1078.004', asset({ categoryId: 'cloud_resource', subcategoryId: 'iam_principal' }))).toBe(true);
    expect(applies('T1078.001', asset({ categoryId: 'identity', subcategoryId: 'group' }))).toBe(false);
  });
});

describe('techniques the door never plays', () => {
  const NEVER = ['T1091', 'T1200', 'T1669', 'T1195', 'T1199', 'T1659'];
  const everyKindOfAsset: Array<EntryAsset> = [
    asset({ exposure: 'internet_facing' }),
    asset({ subcategoryId: 'workstation' }),
    asset({ categoryId: 'identity', subcategoryId: 'user_account' }),
    asset({ categoryId: 'cloud_resource', subcategoryId: 'iam_principal' }),
    asset({ categoryId: 'generic_asset', subcategoryId: null, exposure: 'unknown' }),
  ];

  it.each(NEVER)('%s is not played at initial access', (technique) => {
    expect(isPlayedAtInitialAccess(technique)).toBe(false);
  });

  it('compares on the parent technique', () => {
    expect(isPlayedAtInitialAccess('T1195.002')).toBe(false);
    expect(isPlayedAtInitialAccess('T1199')).toBe(false);
  });

  it.each(NEVER)('%s applies to no asset', (technique) => {
    for (const entry of everyKindOfAsset) {
      expect(applies(technique, entry, 'internet_facing')).toBe(false);
    }
  });

  it.each(['T1190', 'T1133', 'T1566', 'T1189', 'T1078', 'T1566.001', 'T1078.004'])('%s is played at initial access', (technique) => {
    expect(isPlayedAtInitialAccess(technique)).toBe(true);
  });

  it('answers false for a technique that is not an initial access one', () => {
    expect(applies('T1210', asset({ exposure: 'internet_facing' }), 'internet_facing')).toBe(false);
    expect(applies('T1203', asset({ subcategoryId: 'workstation' }))).toBe(false);
  });
});

describe('isInitialAccessTechnique', () => {
  it.each(['T1190', 'T1133', 'T1566', 'T1189', 'T1078', 'T1091', 'T1200', 'T1669', 'T1195', 'T1199', 'T1659'])(
    '%s belongs to the Initial Access tactic',
    (technique) => {
      expect(isInitialAccessTechnique(technique)).toBe(true);
    },
  );

  it('compares on the parent technique', () => {
    expect(isInitialAccessTechnique('T1566.002')).toBe(true);
    expect(isInitialAccessTechnique('T1078.001')).toBe(true);
  });

  it.each(['T1210', 'T1203', 'T1059', 'T1068'])('%s is not an initial access technique', (technique) => {
    expect(isInitialAccessTechnique(technique)).toBe(false);
  });
});

describe('countedExposure', () => {
  it('reads a declared exposure as it is, whatever the setting', () => {
    for (const setting of UNKNOWN_EXPOSURE_COUNTS_AS_VALUES) {
      expect(countedExposure('internet_facing', setting)).toBe('internet_facing');
      expect(countedExposure('internal', setting)).toBe('internal');
    }
  });

  it('counts an unknown exposure as the setting names', () => {
    for (const setting of UNKNOWN_EXPOSURE_COUNTS_AS_VALUES) {
      expect(countedExposure('unknown', setting)).toBe(setting);
    }
  });
});

describe('isEffectivelyExposed', () => {
  it('reads a declared exposure as it is, whatever the setting', () => {
    for (const setting of UNKNOWN_EXPOSURE_COUNTS_AS_VALUES) {
      expect(isEffectivelyExposed('internet_facing', setting)).toBe(true);
      expect(isEffectivelyExposed('internal', setting)).toBe(false);
    }
  });

  it('lets the setting decide for an unknown exposure', () => {
    expect(isEffectivelyExposed('unknown', 'internal')).toBe(false);
    expect(isEffectivelyExposed('unknown', 'internet_facing')).toBe(true);
  });

  it('is the exposure test entryTechniqueApplies applies to T1190 and T1133', () => {
    for (const exposure of ['internal', 'internet_facing', 'unknown'] as const) {
      for (const setting of UNKNOWN_EXPOSURE_COUNTS_AS_VALUES) {
        expect(applies('T1190', asset({ exposure }), setting)).toBe(isEffectivelyExposed(exposure, setting));
      }
    }
  });
});

describe('needsExposureOutsidePerimeter', () => {
  it.each(['T1498', 'T1499', 'T1498.001', 'T1499.002'])('%s is launched at an exposed service', (technique) => {
    expect(needsExposureOutsidePerimeter(technique)).toBe(true);
  });

  it.each(['T1657', 'T1566', 'T1190', 'T1078'])('%s asks nothing of the exposure outside the perimeter', (technique) => {
    expect(needsExposureOutsidePerimeter(technique)).toBe(false);
  });
});
