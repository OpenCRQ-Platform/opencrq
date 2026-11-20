import { describe, expect, it } from 'vitest';
import type { CapabilityCrosswalk } from '../types/capability';
import { crosswalkFrameworkLabel, groupCrosswalkByFramework } from './crosswalk-frameworks';

const entry = (framework: string, externalId: string): CapabilityCrosswalk => ({ framework, externalId });

describe('crosswalkFrameworkLabel', () => {
  it('maps known framework codes to their canonical names', () => {
    expect(crosswalkFrameworkLabel('nist_800_53')).toBe('NIST SP 800-53');
    expect(crosswalkFrameworkLabel('attack_mitigations')).toBe('MITRE ATT&CK Mitigations');
  });

  it('falls back to the raw code for unknown frameworks', () => {
    expect(crosswalkFrameworkLabel('unknown_framework')).toBe('unknown_framework');
  });
});

describe('groupCrosswalkByFramework', () => {
  it('groups entries by framework and resolves labels', () => {
    const groups = groupCrosswalkByFramework([
      entry('nist_800_53', 'SC-7'),
      entry('nist_800_53', 'SI-3'),
      entry('csf_2_0', 'PR.IR-01'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ framework: 'nist_800_53', label: 'NIST SP 800-53', externalIds: ['SC-7', 'SI-3'] });
    expect(groups[1]).toEqual({ framework: 'csf_2_0', label: 'NIST CSF 2.0', externalIds: ['PR.IR-01'] });
  });

  it('orders groups by the defined display order, not insertion order', () => {
    const groups = groupCrosswalkByFramework([
      entry('d3fend', 'D3-MFA'),
      entry('nist_800_53', 'AC-4'),
      entry('iso_27001', 'A.8.5'),
    ]);

    expect(groups.map((group) => group.framework)).toEqual(['nist_800_53', 'iso_27001', 'd3fend']);
  });

  it('sorts external ids within a framework for stable output', () => {
    const groups = groupCrosswalkByFramework([
      entry('nist_800_53', 'SI-10'),
      entry('nist_800_53', 'AC-4'),
      entry('nist_800_53', 'SC-7'),
    ]);

    expect(groups[0]?.externalIds).toEqual(['AC-4', 'SC-7', 'SI-10']);
  });

  it('returns an empty array when there is no crosswalk', () => {
    expect(groupCrosswalkByFramework([])).toEqual([]);
  });
});
