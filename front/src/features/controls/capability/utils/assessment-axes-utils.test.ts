import { i18n } from '@lingui/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityAssessment, CapabilityDetail, CapabilityEventSource } from '../types/capability';
import { messages as frenchMessages } from '../../../../locales/fr/messages.po';
import {
  assessmentSourceNames,
  assumedLevelOf,
  derivedAxesOf,
  eventSourceNamesByAxis,
  hasSaveWork,
  isSaveComplete,
  isUnfed,
  joinSourceNames,
  modeSwitchesOf,
  planAssessmentSave,
  tenantAssessmentProvenance,
} from './assessment-axes-utils';

const assessment = (overrides: Partial<CapabilityAssessment> = {}): CapabilityAssessment => ({
  strengthRung: 'L2',
  coverageBucket: 'L2',
  strengthMode: 'auto',
  coverageMode: 'auto',
  coverageBasis: 'measured',
  comment: null,
  ...overrides,
});

const CSF_SOURCE = { source: 'nist-csf-2.0', frameworkTitle: 'NIST CSF 2.0' };

const capability = (overrides: Partial<CapabilityDetail> = {}): CapabilityDetail => ({
  id: 'iam',
  externalId: 'IDP',
  name: 'Identity and Access Management',
  description: '',
  domain: 'identities',
  position: 19,
  assessment: assessment(),
  lastAssessedAt: '2026-10-02T10:00:00.000Z',
  lastAssessedBy: { userId: 'u1', name: 'Alice' },
  lastAssessedConnector: null,
  lastDerivedAt: '2026-09-30T10:00:00.000Z',
  lastDerivedBy: null,
  assessmentSources: [
    { axis: 'strength', ...CSF_SOURCE },
    { axis: 'strength', source: 'drata', frameworkTitle: null },
    { axis: 'coverage', source: 'drata', frameworkTitle: null },
  ],
  rungs: [],
  edges: [],
  crosswalk: [],
  securityPlatformFamilies: [],
  protectedFamilies: [],
  ...overrides,
});

describe('axes of an assessment', () => {
  it('reads the derived axes', () => {
    const mixed = assessment({ coverageMode: 'manual' });
    expect(derivedAxesOf(mixed)).toEqual(['strength']);
    expect(derivedAxesOf(null)).toEqual([]);
  });
});

describe('isUnfed', () => {
  it('reads a derived axis listing no source as one no source feeds', () => {
    const coverageFed = [{ axis: 'coverage' as const }];
    expect(isUnfed(assessment(), coverageFed, 'strength')).toBe(true);
    expect(isUnfed(assessment(), coverageFed, 'coverage')).toBe(false);
    expect(isUnfed(assessment({ strengthMode: 'manual' }), [], 'strength')).toBe(false);
  });
});

describe('assumedLevelOf', () => {
  const pooled = { coverageBucket: 'L3' as const, coverageBasis: 'assumed', assumedFromLevel: 5 };

  it('names the level only while the live pooling gives the bucket the row holds', () => {
    expect(assumedLevelOf(pooled, 'L3')).toBe(5);
    expect(assumedLevelOf(pooled, 'L1')).toBeNull();
  });

  it('names no level for another basis or before the pooling loads', () => {
    expect(assumedLevelOf({ ...pooled, coverageBasis: 'typed' }, 'L3')).toBeNull();
    expect(assumedLevelOf(undefined, 'L3')).toBeNull();
  });
});

describe('assessmentSourceNames', () => {
  it('names each source once, Drata first, a framework under its title', () => {
    expect(assessmentSourceNames(capability().assessmentSources)).toEqual(['Drata', 'NIST CSF 2.0']);
  });
});

describe('eventSourceNamesByAxis', () => {
  beforeEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  const eventSource = (overrides: Partial<CapabilityEventSource> = {}): CapabilityEventSource => ({
    axis: 'strength',
    ...CSF_SOURCE,
    complianceAssessmentId: '0199a000-0000-7000-8000-000000000002',
    complianceAssessmentName: 'T2 2026',
    ...overrides,
  });
  const drataSource = (axis: CapabilityEventSource['axis']): CapabilityEventSource =>
    ({ axis, source: 'drata', frameworkTitle: null, complianceAssessmentId: null, complianceAssessmentName: null });

  it('names Drata first, then each assessment under its framework title', () => {
    expect(eventSourceNamesByAxis([
      eventSource({ complianceAssessmentId: '0199a000-0000-7000-8000-000000000004', complianceAssessmentName: 'T4 2025' }),
      eventSource(),
      drataSource('strength'),
      drataSource('coverage'),
    ])).toEqual([
      { axis: 'strength', names: ['Drata', 'NIST CSF 2.0 · T2 2026', 'NIST CSF 2.0 · T4 2025'] },
      { axis: 'coverage', names: ['Drata'] },
    ]);
  });

  it('falls back on the source key without a framework title, and on the framework alone without an assessment name', () => {
    expect(eventSourceNamesByAxis([
      eventSource({ axis: 'coverage', source: 'cis-v8', frameworkTitle: null }),
      eventSource({ axis: 'strength', complianceAssessmentId: null, complianceAssessmentName: null }),
    ])).toEqual([
      { axis: 'strength', names: ['NIST CSF 2.0'] },
      { axis: 'coverage', names: ['Cis-v8 · T2 2026'] },
    ]);
  });

  it('names two assessments sharing a name once each, and a repeated assessment once', () => {
    expect(eventSourceNamesByAxis([
      eventSource({ complianceAssessmentId: '0199a000-0000-7000-8000-000000000003' }),
      eventSource(),
      eventSource(),
    ])).toEqual([
      { axis: 'strength', names: ['NIST CSF 2.0 · T2 2026', 'NIST CSF 2.0 · T2 2026'] },
    ]);
  });

  it('names no axis for an event without sources', () => {
    expect(eventSourceNamesByAxis([])).toEqual([]);
  });
});

describe('joinSourceNames', () => {
  afterEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('joins two and three sources in English', () => {
    i18n.load('en', {});
    i18n.activate('en');
    expect(joinSourceNames(['Drata'])).toBe('Drata');
    expect(joinSourceNames(['Drata', 'NIST CSF 2.0'])).toBe('Drata and NIST CSF 2.0');
    expect(joinSourceNames(['Drata', 'NIST CSF 2.0', 'CIS Controls'])).toBe('Drata, NIST CSF 2.0 and CIS Controls');
  });

  it('repeats the preposition before each source in French', () => {
    i18n.load('fr', frenchMessages);
    i18n.activate('fr');
    expect(joinSourceNames(['Drata', 'NIST CSF 2.0'])).toBe('Drata et de NIST CSF 2.0');
    expect(joinSourceNames(['Drata', 'NIST CSF 2.0', 'CIS Controls'])).toBe('Drata, de NIST CSF 2.0 et de CIS Controls');
  });
});

describe('tenantAssessmentProvenance', () => {
  it('names every source at the derivation\'s latest write while an axis is derived, even after a declaration', () => {
    expect(tenantAssessmentProvenance(capability({ assessment: assessment({ coverageMode: 'manual' }) }))).toEqual({
      at: '2026-09-30T10:00:00.000Z',
      by: null,
      derivedFrom: ['Drata', 'NIST CSF 2.0'],
    });
  });

  it('names the declaring user once both axes are declared', () => {
    const declared = capability({ assessment: assessment({ strengthMode: 'manual', coverageMode: 'manual' }), assessmentSources: [] });
    expect(tenantAssessmentProvenance(declared)).toEqual({
      at: '2026-10-02T10:00:00.000Z',
      by: { userId: 'u1', name: 'Alice' },
      derivedFrom: null,
    });
  });

  it('reads a derivation writer with no known source as a derivation all the same', () => {
    const detached = capability({
      assessment: assessment({ strengthMode: 'manual', coverageMode: 'manual' }),
      assessmentSources: [],
      lastAssessedBy: null,
      lastAssessedConnector: 'derivation',
    });
    expect(tenantAssessmentProvenance(detached).derivedFrom).toEqual([]);
  });
});

describe('planAssessmentSave', () => {
  const derivedBoth = {
    strength: { value: 'L2' as const, attached: true },
    coverage: { value: 'L2' as const, attached: true },
  };

  it('declares the coverage alone when only the coverage is picked', () => {
    const plan = planAssessmentSave(derivedBoth, { ...derivedBoth, coverage: { value: 'L3', attached: false } });
    expect(plan).toEqual({ declare: { strengthRung: null, coverageBucket: 'L3' }, reattach: [] });
  });

  it('declares a derived axis picked at the value it already holds', () => {
    const plan = planAssessmentSave(derivedBoth, { ...derivedBoth, coverage: { value: 'L2', attached: false } });
    expect(plan.declare).toEqual({ strengthRung: null, coverageBucket: 'L2' });
  });

  it('re-attaches a declared axis, declaring nothing', () => {
    const declaredCoverage = { ...derivedBoth, coverage: { value: 'L3' as const, attached: false } };
    const plan = planAssessmentSave(declaredCoverage, { ...declaredCoverage, coverage: { value: 'L2', attached: true } });
    expect(plan).toEqual({ declare: null, reattach: ['coverage'] });
  });

  it('has nothing to save when nothing moved', () => {
    expect(hasSaveWork(planAssessmentSave(derivedBoth, derivedBoth))).toBe(false);
  });
});

describe('modeSwitchesOf', () => {
  const derivedBoth = {
    strength: { value: 'L2' as const, attached: true },
    coverage: { value: 'L2' as const, attached: true },
  };

  it('names each axis switched, in either direction', () => {
    const current = { strength: { value: 'L2' as const, attached: false }, coverage: { value: 'L2' as const, attached: true } };
    expect(modeSwitchesOf(derivedBoth, current)).toEqual([{ axis: 'strength', toAuto: false }]);
    expect(modeSwitchesOf(current, derivedBoth)).toEqual([{ axis: 'strength', toAuto: true }]);
  });

  it('sees no switch in a value change on an axis that stays manual', () => {
    const manual = { ...derivedBoth, coverage: { value: 'L1' as const, attached: false } };
    expect(modeSwitchesOf(manual, { ...manual, coverage: { value: 'L2', attached: false } })).toEqual([]);
  });
});

describe('isSaveComplete', () => {
  it('holds back a manual axis that has no value yet', () => {
    expect(isSaveComplete({
      strength: { value: 'L2', attached: true },
      coverage: { value: null, attached: false },
    })).toBe(false);
  });

  it('lets a derived axis stay blank', () => {
    expect(isSaveComplete({
      strength: { value: 'L2', attached: false },
      coverage: { value: null, attached: true },
    })).toBe(true);
  });
});
