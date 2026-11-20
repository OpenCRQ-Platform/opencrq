import { describe, expect, it } from 'vitest';
import type { ProtectingControl } from './protected-by-utils';
import {
  coverageCellsFilled,
  fleetTotal,
  hasLetThrough,
  splitByTesting,
  splitProtectingControls,
  strengthCellsFilled,
  testedTechniqueIds,
} from './protected-by-utils';

const NEVER = { prevention: null, detection: null, lastRunAt: null };

const technique = (
  externalId: string,
  here: ProtectingControl['standsOn'][number]['here'],
  fleet: Omit<ProtectingControl['standsOn'][number]['fleet'], 'assetCount'>,
  assetCount = 1,
): ProtectingControl['standsOn'][number] => ({
  mitreTechniqueId: externalId,
  externalId,
  name: null,
  onAsset: true,
  here,
  fleet: { ...fleet, assetCount },
});

const control = (overrides: Partial<ProtectingControl>): ProtectingControl => ({
  capabilityId: overrides.externalId ?? 'X',
  externalId: 'X',
  name: 'Control',
  strengthRung: 'L0',
  coverageBucket: 'L0',
  strengthSource: 'tenant',
  coverageSource: 'tenant',
  tenantStrengthRung: null,
  tenantCoverageBucket: null,
  assessed: false,
  protectsAssetCategory: true,
  testable: false,
  assetTechniqueCount: 1,
  testedHere: null,
  standsOn: [],
  ...overrides,
});

const assessed = (externalId: string, strengthRung: ProtectingControl['strengthRung'], assetTechniqueCount: number) =>
  control({ externalId, strengthRung, coverageBucket: 'L2', assessed: true, assetTechniqueCount });

describe('splitProtectingControls', () => {
  it('ranks by effectiveness, then by technique count, the unassessed controls last', () => {
    const { protecting } = splitProtectingControls([
      control({ externalId: 'APPH', assetTechniqueCount: 1 }),
      assessed('WAF', 'L2', 2),
      control({ externalId: 'DDOS', assetTechniqueCount: 4 }),
      assessed('IDP', 'L3', 12),
      assessed('PAM', 'L2', 9),
      control({ externalId: 'ZTNA', assetTechniqueCount: 1 }),
    ]);

    expect(protecting.map((row) => row.externalId)).toEqual(['IDP', 'PAM', 'WAF', 'DDOS', 'APPH', 'ZTNA']);
  });

  it('sets apart the controls that protect another category', () => {
    const { protecting, testedOutside } = splitProtectingControls([
      assessed('IDP', 'L2', 9),
      control({ externalId: 'EDR', protectsAssetCategory: false }),
    ]);

    expect(protecting.map((row) => row.id)).toEqual(['IDP']);
    expect(testedOutside.map((row) => row.id)).toEqual(['EDR']);
  });
});

describe('level cells', () => {
  it('fills none of the three cells for the absent rung and all of them for the top one', () => {
    expect([strengthCellsFilled('L0'), strengthCellsFilled('L2'), strengthCellsFilled('L3')]).toEqual([0, 2, 3]);
    expect([coverageCellsFilled('L0'), coverageCellsFilled('L2'), coverageCellsFilled('L3')]).toEqual([0, 2, 3]);
  });
});

describe('hasLetThrough', () => {
  it('warns when one run on either side got through', () => {
    expect(hasLetThrough({ prevention: { held: 1, total: 2 }, detection: null })).toBe(true);
    expect(hasLetThrough({ prevention: { held: 1, total: 1 }, detection: { held: 0, total: 1 } })).toBe(true);
  });

  it('stays quiet when every run held', () => {
    expect(hasLetThrough({ prevention: { held: 2, total: 2 }, detection: null })).toBe(false);
  });
});

describe('fleetTotal', () => {
  it('adds up each function across the techniques a run reached in the fleet', () => {
    const total = fleetTotal(control({
      standsOn: [
        technique('T1078', NEVER, { prevention: { held: 0, total: 1 }, detection: null, lastRunAt: null }),
        technique('T1110', NEVER, { prevention: { held: 2, total: 2 }, detection: { held: 1, total: 1 }, lastRunAt: null }, 2),
        technique('T1550', NEVER, NEVER, 0),
      ],
    }));

    expect(total).toEqual({
      verdicts: { prevention: { held: 2, total: 3 }, detection: { held: 1, total: 1 } },
      techniqueCount: 2,
    });
  });

  it('reads no verdict when nothing ran anywhere', () => {
    expect(fleetTotal(control({ standsOn: [technique('T1550', NEVER, NEVER, 0)] }))).toEqual({
      verdicts: { prevention: null, detection: null },
      techniqueCount: 0,
    });
  });
});

describe('splitByTesting', () => {
  it('keeps a technique run in the fleet only among the tested ones', () => {
    const ran = { prevention: { held: 1, total: 1 }, detection: null, lastRunAt: null };
    const { tested, neverTested } = splitByTesting(control({
      standsOn: [
        technique('T1110', ran, ran),
        technique('T1110.001', NEVER, ran),
        technique('T1110.003', NEVER, NEVER, 0),
      ],
    }));

    expect(tested.map((entry) => entry.externalId)).toEqual(['T1110', 'T1110.001']);
    expect(neverTested.map((entry) => entry.externalId)).toEqual(['T1110.003']);
  });
});

describe('testedTechniqueIds', () => {
  it('names only the techniques a run reached on the asset', () => {
    const fleet = { ...NEVER, assetCount: 0 };
    expect(testedTechniqueIds(control({
      standsOn: [
        { mitreTechniqueId: 'a', externalId: 'T1003', name: null, onAsset: false, here: { prevention: { held: 1, total: 1 }, detection: null, lastRunAt: null }, fleet },
        { mitreTechniqueId: 'b', externalId: 'T1190', name: null, onAsset: true, here: NEVER, fleet },
      ],
    }))).toEqual(['T1003']);
  });
});
