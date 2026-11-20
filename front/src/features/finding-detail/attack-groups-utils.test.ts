import { describe, expect, it } from 'vitest';
import type { AttackClaimRow } from './attack-groups-utils';
import { coverageMarker, exposureReadingOf, groupAttackRows, matrixTechniques, tacticNamesByTechnique } from './attack-groups-utils';

const row = (externalId: string, over: Partial<AttackClaimRow> = {}): AttackClaimRow => ({
  mitreTechniqueId: `id-${externalId}`,
  externalId,
  name: externalId,
  role: 'exploitation_technique',
  lane: 'curated',
  group: 'exploitation',
  justification: { kind: 'curated' },
  grain: 'parent',
  carriedByAssetFamily: true,
  ...over,
});

describe('groupAttackRows', () => {
  it('returns the four groups in attack order, empty ones included', () => {
    const grouped = groupAttackRows([row('T1040', { group: 'weakness', lane: 'structural' }), row('T1190')]);
    expect(grouped.map((entry) => [entry.group, entry.rows.map((r) => r.externalId)])).toEqual([
      ['exploitation', ['T1190']],
      ['primary_impact', []],
      ['secondary_impact', []],
      ['weakness', ['T1040']],
    ]);
  });

  it('sets aside an exploitation the asset family cannot carry, never an impact nor a weakness row', () => {
    const grouped = groupAttackRows([
      row('T1190', { carriedByAssetFamily: false }),
      row('T1185', { group: 'weakness', carriedByAssetFamily: false }),
      row('T1486', { group: 'primary_impact', carriedByAssetFamily: false }),
    ]);
    expect(grouped.find((entry) => entry.group === 'exploitation')?.setAside.map((r) => r.externalId)).toEqual(['T1190']);
    expect(grouped.find((entry) => entry.group === 'weakness')?.rows.map((r) => r.externalId)).toEqual(['T1185']);
    expect(grouped.find((entry) => entry.group === 'primary_impact')?.rows.map((r) => r.externalId)).toEqual(['T1486']);
  });
});

describe('matrixTechniques', () => {
  it('gives a technique standing in two groups the accent of the earlier one', () => {
    const cells = matrixTechniques(groupAttackRows([
      row('T1505.003', { group: 'weakness' }),
      row('T1505.003', { group: 'secondary_impact' }),
    ]));
    expect(cells).toEqual([{
      mitreTechniqueId: 'id-T1505.003',
      row: row('T1505.003', { group: 'secondary_impact' }),
      group: 'secondary_impact',
      groups: ['secondary_impact', 'weakness'],
      setAside: false,
    }]);
  });

  it('outlines a technique only set aside', () => {
    const [cell] = matrixTechniques(groupAttackRows([row('T1190', { carriedByAssetFamily: false })]));
    expect(cell.setAside).toBe(true);
  });
});

describe('tacticNamesByTechnique', () => {
  it('orders the tactics and lets a sub-technique fall back on its parent', () => {
    const tactics = tacticNamesByTechnique({
      tactics: [{ id: 'ta-2', name: 'Persistence', order: 2 }, { id: 'ta-1', name: 'Initial Access', order: 1 }],
      techniques: [{ id: 'te-1', parentTechniqueId: null }, { id: 'te-1-1', parentTechniqueId: 'te-1' }],
      junctions: [{ tacticId: 'ta-2', techniqueId: 'te-1' }, { tacticId: 'ta-1', techniqueId: 'te-1' }],
    });
    expect(tactics.get('te-1')).toEqual(['Initial Access', 'Persistence']);
    expect(tactics.get('te-1-1')).toEqual(['Initial Access', 'Persistence']);
  });
});

describe('coverageMarker', () => {
  it('draws the count only on a technique that does not hold on every asset', () => {
    expect(coverageMarker({ assetCount: 50, setAside: [], exposures: [] }, 120)).toBe('50/120');
    expect(coverageMarker({ assetCount: 120, setAside: [], exposures: [] }, 120)).toBeUndefined();
    expect(coverageMarker(undefined, 120)).toBeUndefined();
  });
});

describe('exposureReadingOf', () => {
  it('names the exposures a topology row was read on', () => {
    expect(exposureReadingOf(['internet_facing', 'unknown'])).toBe('internetFacingAndUnknown');
    expect(exposureReadingOf(['internal', 'unknown'])).toBe('internalAndUnknown');
    expect(exposureReadingOf(['internet_facing', 'internal'])).toBe('internetFacingAndInternal');
    expect(exposureReadingOf(['internet_facing', 'internal', 'unknown'])).toBe('all');
    expect(exposureReadingOf(['internet_facing'])).toBe('internetFacing');
    expect(exposureReadingOf(['internal'])).toBe('internal');
    expect(exposureReadingOf(['unknown'])).toBe('unknown');
  });
});
