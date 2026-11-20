import { describe, expect, it } from 'vitest';
import { deriveCapabilityAssessments, DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS } from './capability-derivation';
import { DRATA_DCF_CAPABILITY_EVIDENCE } from './data/drata-capability-mapping.generated';

const derive = (readiness: Record<string, boolean>) => {
  const byId = new Map(deriveCapabilityAssessments(new Map(Object.entries(readiness)))
    .map((entry) => [entry.capabilityExternalId, entry]));
  return byId;
};

// EDR: six pairs attesting L1 only, DCF-50 and DCF-291 org-wide. IDP: four L1 pairs, DCF-67
// org-wide, DCF-58, DCF-354 and DCF-355 slices. SAT: L1 by DCF-36 and DCF-503 (both org-wide), L2
// by DCF-681 alone. SIEM: L1 by DCF-80, the org-wide DCF-698 and the slice DCF-87, L1 and L3 by the
// org-wide DCF-560, nothing at L2. TLS: DCF-55, attesting L2 only. NGFW: DCF-85, org-wide, among
// its L1 pairs. APPH: four L1 pairs naming no reach, and DCF-58, attesting L3 alone on a slice.
// IGA: L1 by the slice DCF-43 and the org-wide DCF-70 and DCF-335, L2 by the org-wide DCF-11 and
// the slices DCF-524 and DCF-894. A code absent from the mirror counts for nothing.
const EDR_ALL_READY = {
  'DCF-50': true, 'DCF-291': true, 'DCF-293': true, 'DCF-294': true, 'DCF-903': true, 'DCF-522': true,
};
const IDP_ALL_READY = { 'DCF-58': true, 'DCF-67': true, 'DCF-354': true, 'DCF-355': true };
const APPH_L1_READY = { 'DCF-338': true, 'DCF-339': true, 'DCF-340': true, 'DCF-676': true };

describe('deriveCapabilityAssessments', () => {
  it('derives no level its ready evidence does not attest, however many pairs are ready', () => {
    const edr = derive(EDR_ALL_READY).get('EDR')!;
    expect(edr.strengthRung).toBe('L1');
    expect(edr.coverageBucket).toBe('L2');
  });

  it('climbs to L2 on a single pair attesting it, once L1 holds', () => {
    expect(derive({ 'DCF-36': true, 'DCF-503': true, 'DCF-681': true }).get('SAT')!.strengthRung).toBe('L2');
    expect(derive({ 'DCF-36': true, 'DCF-503': true, 'DCF-681': false }).get('SAT')!.strengthRung).toBe('L1');
  });

  it('never skips a level: an upper level without the one below derives nothing from it', () => {
    const sat = derive({ 'DCF-36': false, 'DCF-503': false, 'DCF-681': true }).get('SAT')!;
    expect(sat.strengthRung).toBe('L0');
    expect(sat.coverageBucket).toBe('L0');
    expect(derive({ 'DCF-80': true, 'DCF-698': true, 'DCF-560': true }).get('SIEM')!.strengthRung).toBe('L1');
  });

  it('tells a strength at the ceiling of the mirrored evidence from a failure below it', () => {
    expect(derive(EDR_ALL_READY).get('EDR')!.atCeiling).toBe(true);
    expect(derive({ ...EDR_ALL_READY, 'DCF-293': false, 'DCF-294': false }).get('EDR')!.atCeiling).toBe(false);
  });

  it('holds a level carried by six pairs through one lapsed pair, not two', () => {
    expect(derive({ ...EDR_ALL_READY, 'DCF-293': false }).get('EDR')!.strengthRung).toBe('L1');
    expect(derive({ ...EDR_ALL_READY, 'DCF-293': false, 'DCF-294': false }).get('EDR')!.strengthRung).toBe('L0');
  });

  it('leaves a failing slice out of the strength count, since coverage already reports it', () => {
    const idp = derive({ ...IDP_ALL_READY, 'DCF-58': false, 'DCF-354': false, 'DCF-355': false }).get('IDP')!;
    expect(idp.strengthRung).toBe('L1');
    expect(idp.coverageBucket).toBe('L2');
  });

  it('still counts a ready slice against a failing org-wide pair', () => {
    expect(derive({ ...IDP_ALL_READY, 'DCF-67': false }).get('IDP')!.strengthRung).toBe('L1');
    expect(derive({ ...IDP_ALL_READY, 'DCF-67': false, 'DCF-355': false }).get('IDP')!.strengthRung).toBe('L0');
  });

  it('yields no reading when the present evidence says nothing of L1', () => {
    expect(derive({ 'DCF-55': true }).has('TLS')).toBe(false);
  });

  it('defaults coverage from a ready org-wide pair when no slice exists', () => {
    expect(derive({ 'DCF-85': true }).get('NGFW')!.coverageBucket).toBe('L2');
    expect(derive({ 'DCF-338': true }).get('APPH')!.coverageBucket).toBe('L1');
  });

  it('floors coverage on a ready org-wide pair only, never on a failing one', () => {
    const edr = derive({ 'DCF-50': false, 'DCF-293': true, 'DCF-294': true, 'DCF-522': true }).get('EDR')!;
    expect(edr.strengthRung).toBe('L1');
    expect(edr.coverageBucket).toBe('L1');
  });

  it('measures coverage from a slice, ready or not, or from a ready org-wide pair', () => {
    expect(derive({ ...IDP_ALL_READY, 'DCF-67': false }).get('IDP')!.coverageMeasured).toBe(true);
    expect(derive(EDR_ALL_READY).get('EDR')!.coverageMeasured).toBe(true);
    expect(derive({ 'DCF-50': false, 'DCF-293': true, 'DCF-294': true, 'DCF-522': true }).get('EDR')!.coverageMeasured).toBe(false);
  });

  it('measures nothing with the L0 a strength L0 pins on coverage, a ready org-wide pair or a slice notwithstanding', () => {
    const edr = derive({ 'DCF-50': true, 'DCF-291': false, 'DCF-293': false, 'DCF-294': false }).get('EDR')!;
    expect(edr).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0', coverageMeasured: false });
    const idp = derive(Object.fromEntries(Object.keys(IDP_ALL_READY).map((code) => [code, false]))).get('IDP')!;
    expect(idp).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0', coverageMeasured: false });
    expect(idp.supportingCodes).toHaveLength(4);
  });

  it('does not move SAT\'s coverage with DCF-681, a part of the programme rather than a slice', () => {
    const withSimulations = derive({ 'DCF-36': true, 'DCF-503': true, 'DCF-681': true }).get('SAT')!;
    const without = derive({ 'DCF-36': true, 'DCF-503': true, 'DCF-681': false }).get('SAT')!;
    expect(withSimulations.coverageBucket).toBe(without.coverageBucket);
    expect(withSimulations.coverageMeasured).toBe(without.coverageMeasured);
  });

  it('reads no coverage from a pair attesting only a level the strength never reaches', () => {
    const unmeasuredL1 = { strengthRung: 'L1', coverageBucket: 'L1', coverageMeasured: false };
    expect(derive(APPH_L1_READY).get('APPH')).toMatchObject(unmeasuredL1);
    expect(derive({ ...APPH_L1_READY, 'DCF-58': false }).get('APPH')).toMatchObject(unmeasuredL1);
    expect(derive({ ...APPH_L1_READY, 'DCF-58': true }).get('APPH')).toMatchObject(unmeasuredL1);
  });

  it('lets an upper level\'s slice move coverage neither way while that level does not hold', () => {
    expect(derive({ 'DCF-43': true, 'DCF-70': true, 'DCF-524': false }).get('IGA'))
      .toMatchObject({ strengthRung: 'L1', coverageBucket: 'L3' });
    expect(derive({ 'DCF-43': true, 'DCF-524': true, 'DCF-11': false }).get('IGA'))
      .toMatchObject({ strengthRung: 'L1', coverageBucket: 'L2' });
  });

  it('reads coverage from a pair attesting a held level beside one above it', () => {
    expect(derive({ 'DCF-80': true, 'DCF-87': true, 'DCF-560': true }).get('SIEM'))
      .toMatchObject({ strengthRung: 'L1', coverageBucket: 'L3' });
  });

  it('walks the slice ladder, floored at broad by a ready org-wide pair', () => {
    expect(derive(IDP_ALL_READY).get('IDP')!.coverageBucket).toBe('L3');
    expect(derive({ ...IDP_ALL_READY, 'DCF-355': false }).get('IDP')!.coverageBucket).toBe('L2');
    expect(derive({ 'DCF-58': true, 'DCF-354': false, 'DCF-355': false }).get('IDP')!.coverageBucket).toBe('L1');
  });

  it('backs a single-slice full with a ready org-wide pair, and demotes it without one', () => {
    expect(derive({ 'DCF-698': true, 'DCF-87': true }).get('SIEM')!.coverageBucket).toBe('L3');
    expect(derive({ 'DCF-80': true, 'DCF-87': true }).get('SIEM')!.coverageBucket).toBe('L2');
  });

  it('floors a losing mosaic at broad when an org-wide pair is ready', () => {
    expect(derive({ 'DCF-698': true, 'DCF-87': false }).get('SIEM')!.coverageBucket).toBe('L2');
  });

  it('yields nothing for a capability with no mirrored evidence', () => {
    const byId = derive({ 'DCF-88': true, 'DCF-708': true });
    expect(byId.has('IDP')).toBe(false);
    expect(byId.has('SCA')).toBe(false);
    expect(byId.has('DDOS')).toBe(false);
  });
});

describe('DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS', () => {
  it('lists the capabilities the mapping keys a pair for, and those alone', () => {
    expect(DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS).toEqual(expect.arrayContaining(['EDR', 'IDP', 'WAF']));
    expect(DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS).not.toContain('NAC');
    expect(DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS).not.toContain('PAM');
    expect([...DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS].sort()).toEqual(Object.entries(DRATA_DCF_CAPABILITY_EVIDENCE)
      .filter(([, pairs]) => pairs.length > 0)
      .map(([externalId]) => externalId)
      .sort());
  });
});
