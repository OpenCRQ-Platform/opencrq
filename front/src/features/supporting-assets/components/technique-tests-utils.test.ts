import { describe, expect, it } from 'vitest';
import { hasTestReading, heldPostureBand, heldSeverityBand, heldShare, testedTechniqueCount } from './technique-tests-utils';

describe('heldShare', () => {
  it('should score an asset holding 65 prevention results out of 163 at 40, in the weak band', () => {
    expect(heldShare({ held: 65, total: 163 })).toBe(40);
    expect(heldPostureBand({ held: 65, total: 163 })).toBe('weak');
  });

  it('should grade a share by the posture bands, 23 out of 100 falling under the weak band at 25', () => {
    expect(heldShare({ held: 23, total: 100 })).toBe(23);
    expect(heldPostureBand({ held: 23, total: 100 })).toBe('critical');
    expect(heldPostureBand({ held: 25, total: 100 })).toBe('weak');
    expect(heldSeverityBand({ held: 25, total: 100 })).toBe('high');
  });

  it('should paint a strong share at the safe end of the severity ramp', () => {
    expect(heldSeverityBand({ held: 30, total: 36 })).toBe('low');
  });
});

describe('testedTechniqueCount', () => {
  const tests = new Map([
    ['t1190', { prevention: { held: 23, total: 100 }, detection: { held: 61, total: 100 } }],
    ['t1213', { prevention: null, detection: { held: 7, total: 20 } }],
    ['t1003', { prevention: { held: 1, total: 1 }, detection: null }],
  ]);

  it('should count only the shown techniques tested for that type', () => {
    expect(testedTechniqueCount(['t1190', 't1213', 't1078'], tests, 'prevention')).toBe(1);
    expect(testedTechniqueCount(['t1190', 't1213', 't1078'], tests, 'detection')).toBe(2);
  });
});

describe('hasTestReading', () => {
  it('should tell a technique tested for either type from one never tested', () => {
    expect(hasTestReading({ prevention: null, detection: { held: 0, total: 1 } })).toBe(true);
    expect(hasTestReading({ prevention: null, detection: null })).toBe(false);
    expect(hasTestReading(undefined)).toBe(false);
  });
});
