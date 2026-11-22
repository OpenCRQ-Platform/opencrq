import { describe, expect, it } from 'vitest';
import type { AssetCategory } from '../../../supporting-assets/constants';
import { ASSET_CATEGORY_VALUES, UNCLASSIFIED_ASSET_CATEGORY } from '../../../supporting-assets/constants';
import { controlCapabilitiesData } from './capabilities.generated';
import { CONTROL_FAMILY_PROTECTION_PROVENANCE } from './control-family-protection';
import { PROTECTION_BY_EXTERNAL_ID, UNRESOLVED_PROTECTION_CAPABILITY_EXTERNAL_IDS } from './control-family-protection-seed';

/**
 * Pinned pairs, in both directions. A required pair the generator drops silently under-credits its
 * control on every finding of that family, and a forbidden pair credits one where none of the
 * catalogue's links aims it, so neither failure surfaces anywhere else.
 */
const REQUIRED_PAIRS: ReadonlyArray<readonly [string, AssetCategory]> = [
  ['CPS', 'iot_ot_device'],
  ['EDR', 'host'],
  ['EDR', 'identity'],
  ['IDP', 'host'],
  ['IDP', 'identity'],
  ['IDP', 'saas_application'],
  ['ITDR', 'saas_application'],
  ['KMS', 'cloud_resource'],
  ['NDR', 'iot_ot_device'],
  ['PATCH', 'container_workload'],
  ['PATCH', 'web_application'],
  ['SCA', 'source_code'],
  ['SSDLC', 'source_code'],
  ['SAT', 'host'],
  ['SAT', 'mobile_device'],
  ['SEG', 'mobile_device'],
  ['UEM', 'mobile_device'],
  ['WAF', 'web_application'],
  ['ZTNA', 'cloud_resource'],
  ['ZTNA', 'network_device'],
];

const FORBIDDEN_PAIRS: ReadonlyArray<readonly [string, AssetCategory]> = [
  ['DDOS', 'identity'],
  ['DLP', 'cloud_resource'],
  ['EDR', 'web_application'],
  ['KMS', 'network_device'],
];

const PROTECTION_PAIR_COUNT = 167;

const externalIds = Object.keys(PROTECTION_BY_EXTERNAL_ID);
const allEntries = Object.values(PROTECTION_BY_EXTERNAL_ID).flat();
const familiesOf = (externalId: string): ReadonlyArray<AssetCategory> => PROTECTION_BY_EXTERNAL_ID[externalId] ?? [];

describe('CONTROL_FAMILY_PROTECTION', () => {
  it('carries its generation provenance as data values', () => {
    expect(CONTROL_FAMILY_PROTECTION_PROVENANCE.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CONTROL_FAMILY_PROTECTION_PROVENANCE.catalogueVersion).toMatch(/^\d+(\.\d+)*$/);
    expect(CONTROL_FAMILY_PROTECTION_PROVENANCE.capabilityCount).toBe(externalIds.length);
  });

  it('names only assignable asset categories, the unclassified bucket excluded', () => {
    const assignable = new Set<string>(ASSET_CATEGORY_VALUES.filter((category) => category !== UNCLASSIFIED_ASSET_CATEGORY));
    expect([...new Set(allEntries)].filter((family) => !assignable.has(family))).toEqual([]);
  });

  it('repeats no family within a capability', () => {
    for (const externalId of externalIds) {
      const families = familiesOf(externalId);
      expect(new Set(families).size).toBe(families.length);
    }
  });

  // Pinned as a literal so that regenerating against a changed catalogue shows up as a reviewed diff.
  it('holds the expected number of pairs', () => {
    expect(allEntries).toHaveLength(PROTECTION_PAIR_COUNT);
  });

  it('holds every pinned pair and none of the forbidden ones', () => {
    for (const [externalId, family] of REQUIRED_PAIRS) {
      expect(familiesOf(externalId)).toContain(family);
    }
    for (const [externalId, family] of FORBIDDEN_PAIRS) {
      expect(familiesOf(externalId)).not.toContain(family);
    }
  });
});

describe('CONTROL_FAMILY_PROTECTION against the capability catalogue', () => {
  it('keys on exactly the capabilities the catalogue carries', () => {
    expect(externalIds.toSorted()).toEqual(controlCapabilitiesData.map((capability) => capability.externalId).toSorted());
  });

  /*
   * Zero tolerance. A table citing a capability the catalogue does not carry seeds a silently
   * thinner table, and every control it names is then credited on no finding at all.
   */
  it('resolves every cited capability in the vendored catalogue', () => {
    expect(
      UNRESOLVED_PROTECTION_CAPABILITY_EXTERNAL_IDS,
      'Unknown capability external ids in the vendored protection table. Two ways out: regenerate the table against the current catalogue, or update the catalogue to carry these capabilities.',
    ).toEqual([]);
  });
});
