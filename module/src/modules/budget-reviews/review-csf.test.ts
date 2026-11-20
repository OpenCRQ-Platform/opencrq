import { describe, expect, it } from 'vitest';
import { lineCsfFunctions } from './review-csf';

const CROSSWALK = [
  { capabilityId: 'edr', externalId: 'PR.PS-05' },
  { capabilityId: 'edr', externalId: 'DE.CM-09' },
  { capabilityId: 'edr', externalId: 'PR.IR-01' },
  { capabilityId: 'siem', externalId: 'DE.AE-02' },
  { capabilityId: 'scanner', externalId: 'ID.RA-01' },
];

describe('lineCsfFunctions', () => {
  it('takes every function of every control of the line, once each, in the wheel\'s order', () => {
    expect(lineCsfFunctions(['siem', 'edr', 'scanner'], CROSSWALK)).toEqual(['ID', 'PR', 'DE']);
  });

  it('ignores the controls the line does not fund', () => {
    expect(lineCsfFunctions(['siem'], CROSSWALK)).toEqual(['DE']);
  });

  it('answers no function for a line whose controls map to none', () => {
    expect(lineCsfFunctions(['firewall'], CROSSWALK)).toEqual([]);
    expect(lineCsfFunctions([], CROSSWALK)).toEqual([]);
  });

  it('skips an identifier whose prefix is no CSF function', () => {
    expect(lineCsfFunctions(['odd'], [{ capabilityId: 'odd', externalId: 'XX.YY-01' }])).toEqual([]);
  });
});
