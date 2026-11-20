import type { AssessmentMode, ControlDomain } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import { countAssessed, countAssessedByHand, groupCapabilitiesByDomain, planRowPick } from './defenses-utils';

interface Row {
  id: string,
  domain: ControlDomain,
  position: number,
  assessment: { strengthMode: AssessmentMode, coverageMode: AssessmentMode } | null,
}

const row = (id: string, domain: ControlDomain, position: number, assessment: Row['assessment'] = null): Row => ({ id, domain, position, assessment });

const MANUAL = { strengthMode: 'manual', coverageMode: 'manual' } as const;
const AUTO = { strengthMode: 'auto', coverageMode: 'auto' } as const;
const MIXED = { strengthMode: 'auto', coverageMode: 'manual' } as const;

describe('countAssessed', () => {
  it('counts every capability holding an assessment, whoever wrote it', () => {
    expect(countAssessed([row('a', 'network', 1, MANUAL), row('b', 'network', 2, AUTO), row('c', 'network', 3)])).toBe(2);
  });

  it('is zero for an empty catalogue', () => {
    expect(countAssessed([])).toBe(0);
  });
});

describe('countAssessedByHand', () => {
  it('counts a capability with at least one axis declared by hand', () => {
    expect(countAssessedByHand([row('a', 'cloud', 1, MANUAL), row('b', 'cloud', 2, MIXED)])).toBe(2);
  });

  it('leaves out a capability both axes of which are derived, and an unassessed one', () => {
    expect(countAssessedByHand([row('a', 'cloud', 1, AUTO), row('b', 'cloud', 2)])).toBe(0);
  });
});

describe('groupCapabilitiesByDomain', () => {
  const rows = [
    row('cloud-2', 'cloud', 2),
    row('net-1', 'network', 1, MANUAL),
    row('cloud-1', 'cloud', 1, MANUAL),
    row('net-2', 'network', 2),
  ];

  it('lists the domains in the catalogue order, whatever the order of the rows', () => {
    expect(groupCapabilitiesByDomain(rows).map((group) => group.domain)).toEqual(['network', 'cloud']);
  });

  it('keeps the catalogue position inside a domain', () => {
    const [network, cloud] = groupCapabilitiesByDomain(rows);
    expect(network?.capabilities.map((capability) => capability.id)).toEqual(['net-1', 'net-2']);
    expect(cloud?.capabilities.map((capability) => capability.id)).toEqual(['cloud-1', 'cloud-2']);
  });

  it('counts the assessed capabilities of each domain', () => {
    expect(groupCapabilitiesByDomain(rows).map((group) => group.assessed)).toEqual([1, 1]);
  });

  it('leaves out a domain with no capability', () => {
    expect(groupCapabilitiesByDomain([])).toEqual([]);
  });
});

describe('planRowPick', () => {
  const none = { strengthRung: null, coverageBucket: null };

  it('keeps the first pick on an unassessed capability as a draft, since a first declaration names both axes', () => {
    expect(planRowPick(false, none, { axis: 'strength', rung: 'L2' })).toEqual({
      kind: 'draft',
      draft: { strengthRung: 'L2', coverageBucket: null },
    });
  });

  it('saves both axes once the second one is picked', () => {
    expect(planRowPick(false, { strengthRung: 'L2', coverageBucket: null }, { axis: 'coverage', bucket: 'L3' })).toEqual({
      kind: 'save',
      declaration: { strengthRung: 'L2', coverageBucket: 'L3' },
    });
  });

  it('lets the reader change their mind on the drafted axis', () => {
    expect(planRowPick(false, { strengthRung: 'L2', coverageBucket: null }, { axis: 'strength', rung: 'L1' })).toEqual({
      kind: 'draft',
      draft: { strengthRung: 'L1', coverageBucket: null },
    });
  });

  it('saves a pick on its own once the capability is assessed, the other axis left as it stands', () => {
    expect(planRowPick(true, none, { axis: 'coverage', bucket: 'L1' })).toEqual({
      kind: 'save',
      declaration: { strengthRung: null, coverageBucket: 'L1' },
    });
    expect(planRowPick(true, none, { axis: 'strength', rung: 'L0' })).toEqual({
      kind: 'save',
      declaration: { strengthRung: 'L0', coverageBucket: null },
    });
  });
});
