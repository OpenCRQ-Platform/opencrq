import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CapabilityEvent, CapabilityEventSource } from '../types/capability';
import type { EffectivenessMark } from './effectiveness-lifeline-utils';
import { formatDate } from '../../../../utils';
import { effectivenessMarkAnnouncement, effectivenessSourceLine } from './effectiveness-mark-text';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const event = (overrides: Partial<CapabilityEvent> = {}): CapabilityEvent => ({
  id: 'e',
  capabilityId: 'c',
  tenantId: 't',
  organizationId: null,
  userId: 'u',
  connector: null,
  type: 'assessment_change',
  oldStrength: null,
  newStrength: null,
  oldCoverage: null,
  newCoverage: null,
  strengthMode: null,
  coverageMode: null,
  comment: null,
  createdAt: '',
  userName: 'Alice',
  sources: [],
  ...overrides,
});

const drata = (axis: CapabilityEventSource['axis']): CapabilityEventSource => ({
  axis, source: 'drata', frameworkTitle: null, complianceAssessmentId: null, complianceAssessmentName: null,
});

const assessment = (axis: CapabilityEventSource['axis'], source: string, frameworkTitle: string, name: string): CapabilityEventSource => ({
  axis, source, frameworkTitle, complianceAssessmentId: `${source}-${name}`, complianceAssessmentName: name,
});

const derived = (sources: Array<CapabilityEventSource>, overrides: Partial<CapabilityEvent> = {}): Partial<CapabilityEvent> => ({
  type: 'strength_change',
  connector: 'derivation',
  userId: null,
  userName: null,
  oldStrength: 'L1',
  newStrength: 'L2',
  oldCoverage: 'L1',
  newCoverage: 'L1',
  sources,
  ...overrides,
});

const AT = new Date(Date.UTC(2026, 8, 1, 12));

const mark = (value: number | null, previous: number | null, overrides: Partial<CapabilityEvent> = {}): EffectivenessMark => {
  const payload = event(overrides);
  return { at: AT, value, previous, x: 0.5, pointIndex: 1, payload, event: payload };
};

describe('effectivenessSourceLine', () => {
  it('names the user who declared the line', () => {
    expect(effectivenessSourceLine(event())).toBe('Declared by Alice');
  });

  it('says the line was declared without naming a user who has no name', () => {
    expect(effectivenessSourceLine(event({ userName: null }))).toBe('Declared');
  });

  it('keeps the deleted-user wording for a line whose user is gone', () => {
    expect(effectivenessSourceLine(event({ userId: null, userName: null }))).toBe('Declared by a deleted user');
  });

  it('names Drata for a line it derived', () => {
    expect(effectivenessSourceLine(event(derived([drata('strength')])))).toBe('Derived from Drata');
  });

  it('names a framework assessment under its framework title for a line it derived', () => {
    expect(effectivenessSourceLine(event(derived([assessment('strength', 'nist-csf-2', 'NIST CSF 2.0', 'Q2 2026')]))))
      .toBe('Derived from NIST CSF 2.0 · Q2 2026');
  });

  it('names each source of both moved axes once, Drata first', () => {
    const sources = [
      assessment('coverage', 'iso-27001', 'ISO 27001', 'Audit 2026'),
      drata('coverage'),
      assessment('strength', 'nist-csf-2', 'NIST CSF 2.0', 'Q2 2026'),
      drata('strength'),
    ];
    expect(effectivenessSourceLine(event(derived(sources, { newCoverage: 'L3' }))))
      .toBe('Derived from Drata, NIST CSF 2.0 · Q2 2026 and ISO 27001 · Audit 2026');
  });

  it('leaves out the sources of an axis the line did not move', () => {
    const sources = [drata('strength'), assessment('coverage', 'iso-27001', 'ISO 27001', 'Audit 2026')];
    expect(effectivenessSourceLine(event(derived(sources)))).toBe('Derived from Drata');
  });

  it('names every source of a line that only changed its sources', () => {
    const sources = [drata('strength'), assessment('coverage', 'iso-27001', 'ISO 27001', 'Audit 2026')];
    expect(effectivenessSourceLine(event(derived(sources, { type: 'sources_changed', newStrength: 'L1' }))))
      .toBe('Derived from Drata and ISO 27001 · Audit 2026');
  });

  it('says a derived line whose sources are unknown was derived', () => {
    expect(effectivenessSourceLine(event(derived([])))).toBe('Derived');
  });
});

describe('effectivenessMarkAnnouncement', () => {
  const date = (): string => formatDate(AT);

  it('reads the value, its move and the line that made it as whole sentences', () => {
    expect(effectivenessMarkAnnouncement(mark(55, 33), false))
      .toBe(`${date()}, 55%, +22 from 33%. Strength and coverage updated. Declared by Alice.`);
  });

  it('reads a first value without a move', () => {
    expect(effectivenessMarkAnnouncement(mark(55, null), false))
      .toBe(`${date()}, 55%. Strength and coverage updated. Declared by Alice.`);
  });

  it('reads a cleared assessment as no longer assessed', () => {
    expect(effectivenessMarkAnnouncement(mark(null, 55, { type: 'assessment_cleared' }), false))
      .toBe(`${date()}, not assessed, from 55%. Assessment cleared: no source feeds it any more. Declared by Alice.`);
  });

  it('names the sources of a derived line', () => {
    expect(effectivenessMarkAnnouncement(mark(55, 33, derived([drata('strength')])), false))
      .toBe(`${date()}, 55%, +22 from 33%. Strength changed from Basic to Intermediate. Derived from Drata.`);
  });

  it('says a tenant line is inherited inside a scope', () => {
    expect(effectivenessMarkAnnouncement(mark(55, null), true))
      .toBe(`${date()}, 55%. Strength and coverage updated. Declared by Alice. Inherited from the tenant.`);
  });
});
