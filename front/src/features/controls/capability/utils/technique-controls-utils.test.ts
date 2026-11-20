import { describe, expect, it } from 'vitest';
import type { CapabilityAssessment, TechniqueCapability } from '../types/capability';
import type { TechniqueControlTestReading, TechniqueTestOutcome } from '../types/validation';
import { controlCounts, controlRowsForFunction, controlsForFunction, readingOf } from './technique-controls-utils';

const assessment = (
  strengthRung: CapabilityAssessment['strengthRung'],
  coverageBucket: CapabilityAssessment['coverageBucket'],
): CapabilityAssessment => ({
  strengthRung,
  coverageBucket,
  strengthMode: 'manual',
  coverageMode: 'manual',
  coverageBasis: 'declared',
  comment: null,
});

const control = (overrides: Partial<TechniqueCapability> & Pick<TechniqueCapability, 'externalId'>): TechniqueCapability => ({
  id: `id-${overrides.externalId}`,
  name: overrides.externalId,
  function: 'prevent',
  source: 'catalogue',
  state: 'recommended',
  assessment: null,
  inheritedFrom: null,
  ...overrides,
});

describe('controlsForFunction', () => {
  it('keeps only the asked function', () => {
    const result = controlsForFunction([
      control({ externalId: 'EDR', function: 'prevent' }),
      control({ externalId: 'SIEM', function: 'detect' }),
    ], 'detect');
    expect(result.map((c) => c.externalId)).toEqual(['SIEM']);
  });

  it('ranks the most deployed control first and an unassessed one last', () => {
    const result = controlsForFunction([
      control({ externalId: 'PAM' }),
      control({ externalId: 'IDP', assessment: assessment('L2', 'L1') }),
      control({ externalId: 'EDR', assessment: assessment('L3', 'L3') }),
    ], 'prevent');
    expect(result.map((c) => c.externalId)).toEqual(['EDR', 'IDP', 'PAM']);
  });

  it('sinks a removed control below every control that still counts, however well deployed', () => {
    const result = controlsForFunction([
      control({ externalId: 'EDR', state: 'removed', assessment: assessment('L3', 'L3') }),
      control({ externalId: 'PAM' }),
    ], 'prevent');
    expect(result.map((c) => c.externalId)).toEqual(['PAM', 'EDR']);
  });

  it('breaks a tie on the external id, so equal controls keep a stable order', () => {
    const result = controlsForFunction([
      control({ externalId: 'WAF' }),
      control({ externalId: 'APPH' }),
    ], 'prevent');
    expect(result.map((c) => c.externalId)).toEqual(['APPH', 'WAF']);
  });

  it('leaves the given list untouched', () => {
    const controls = [
      control({ externalId: 'PAM' }),
      control({ externalId: 'EDR', assessment: assessment('L3', 'L3') }),
    ];
    controlsForFunction(controls, 'prevent');
    expect(controls.map((c) => c.externalId)).toEqual(['PAM', 'EDR']);
  });
});

const ONE_FAILED: TechniqueTestOutcome = { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 20, share: 0.05 };

const coveredReading = (capabilityId: string, fn: TechniqueControlTestReading['function'] = 'prevent'): TechniqueControlTestReading => ({
  covered: true,
  capabilityId,
  capabilityExternalId: capabilityId.replace('id-', ''),
  capabilityName: capabilityId,
  capabilityRungs: null,
  function: fn,
  mitreTechniqueId: 't1055',
  familyTechniqueId: 't1055',
  parentEfficacy: null,
  declaration: null,
  declared: 0.5,
  efficacy: 0.3,
  tested: null,
});

const uncoveredReading = (capabilityId: string, tested: TechniqueTestOutcome | null = ONE_FAILED): TechniqueControlTestReading => ({
  covered: false,
  capabilityId,
  capabilityExternalId: capabilityId.replace('id-', ''),
  capabilityName: capabilityId,
  capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L1' },
  function: 'prevent',
  mitreTechniqueId: 't1055',
  familyTechniqueId: 't1055',
  tested,
});

describe('controlCounts', () => {
  it('counts every control the tenant has not removed as covering before the readings arrive, and the removed and only tested ones apart', () => {
    expect(controlCounts([
      { ...control({ externalId: 'EDR' }), kind: 'edge' },
      { ...control({ externalId: 'IDP', state: 'added' }), kind: 'edge' },
      { ...control({ externalId: 'PAM', state: 'removed' }), kind: 'edge' },
      { id: 'id-XDR', externalId: 'XDR', name: 'XDR', function: 'prevent', kind: 'tested', rungs: null },
    ], undefined)).toEqual({ covering: 2, notCovered: 2 });
  });

  it('counts no row apart when every listed control covers the technique', () => {
    expect(controlCounts([{ ...control({ externalId: 'EDR' }), kind: 'edge' }], undefined)).toEqual({ covering: 1, notCovered: 0 });
  });

  it('counts a row as the engine reads it, whatever its edge says', () => {
    expect(controlCounts([
      { ...control({ externalId: 'EDR' }), kind: 'edge' },
      { id: 'id-SEG', externalId: 'SEG', name: 'SEG', function: 'prevent', kind: 'tested', rungs: null },
    ], [uncoveredReading('id-EDR'), coveredReading('id-SEG')])).toEqual({ covering: 1, notCovered: 1 });
  });
});

describe('readingOf', () => {
  it('picks the reading of the control on its own function', () => {
    const readings = [coveredReading('id-EDR', 'detect'), coveredReading('id-EDR', 'prevent'), coveredReading('id-PAM', 'prevent')];

    expect(readingOf(readings, control({ externalId: 'EDR', function: 'prevent' }))).toBe(readings[1]);
  });

  it('reads nothing for a control the engine prices nowhere, or before the readings arrive', () => {
    expect(readingOf([coveredReading('id-PAM')], control({ externalId: 'EDR' }))).toBeUndefined();
    expect(readingOf(undefined, control({ externalId: 'EDR' }))).toBeUndefined();
  });
});

describe('controlRowsForFunction', () => {
  it('lists a control only tested on the technique after the ones listed there, with its rungs', () => {
    const rows = controlRowsForFunction(
      [control({ externalId: 'EDR', assessment: assessment('L2', 'L2') })],
      [coveredReading('id-EDR'), uncoveredReading('id-XDR'), uncoveredReading('id-AV')],
      'prevent',
    );

    expect(rows.map((row) => ({ externalId: row.externalId, kind: row.kind }))).toEqual([
      { externalId: 'EDR', kind: 'edge' },
      { externalId: 'AV', kind: 'tested' },
      { externalId: 'XDR', kind: 'tested' },
    ]);
    expect(rows[2]).toMatchObject({ rungs: { strengthRung: 'L2', coverageBucket: 'L1' } });
  });

  it('puts the controls the engine reads first, then an edge it does not read, the removed ones, and the ones only tested', () => {
    const rows = controlRowsForFunction(
      [
        control({ externalId: 'IDP', assessment: assessment('L3', 'L3') }),
        control({ externalId: 'PAM', state: 'removed', assessment: assessment('L3', 'L3') }),
        control({ externalId: 'WAF' }),
      ],
      [uncoveredReading('id-IDP', null), uncoveredReading('id-PAM'), coveredReading('id-WAF'), uncoveredReading('id-XDR')],
      'prevent',
    );

    expect(rows.map((row) => row.externalId)).toEqual(['WAF', 'IDP', 'PAM', 'XDR']);
  });

  it('keeps a tested control the engine reads with the covering ones', () => {
    const rows = controlRowsForFunction([control({ externalId: 'WAF' })], [uncoveredReading('id-WAF', null), coveredReading('id-SEG')], 'prevent');

    expect(rows.map((row) => row.externalId)).toEqual(['SEG', 'WAF']);
  });

  it('leaves out the other function\'s readings', () => {
    expect(controlRowsForFunction([], [coveredReading('id-SIEM', 'detect')], 'prevent')).toEqual([]);
  });
});
