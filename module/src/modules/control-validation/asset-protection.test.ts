import { describe, expect, it } from 'vitest';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type { AssetProtectionInput, FleetFolds, FleetTally } from './asset-protection';
import type { ValidationEvidenceRow } from './engine';
import { deriveAssetProtection } from './asset-protection';

const ASSET = 'asset-1';
const CAP_IDP = 'capability-idp';
const CAP_PAM = 'capability-pam';
const T1110 = 'technique-t1110';
const T1110_001 = 'technique-t1110-001';

const NOW = new Date('2026-09-30T12:00:00Z');
const CONTEXT = { policy: { measuredValidityDays: null }, now: NOW };

const edge = (capabilityId: string, techniqueId: string, state: EffectiveEdge['state'] = 'recommended'): EffectiveEdge => ({
  capabilityId,
  techniqueId,
  function: 'prevent',
  source: 'catalogue',
  state,
});

const row = (overrides: Partial<ValidationEvidenceRow>): ValidationEvidenceRow => ({
  supportingAssetId: ASSET,
  mitreTechniqueId: T1110,
  parentTechniqueId: null,
  expectationType: 'prevention',
  securityPlatformType: 'ISPM',
  sourceScenarioId: 'scenario-1',
  sourceSimulationId: 'simulation-1',
  evaluatedAt: new Date('2026-09-28T12:00:00Z'),
  runVerdict: 'dismissed',
  runAt: new Date('2026-09-28T12:00:00Z'),
  ...overrides,
});

const input = (overrides: Partial<AssetProtectionInput>): AssetProtectionInput => ({
  categoryId: 'web_application',
  assetTechniqueIds: [T1110, T1110_001],
  techniques: new Map([
    [T1110, { id: T1110, externalId: 'T1110', name: 'Brute Force', parentTechniqueId: null }],
    [T1110_001, { id: T1110_001, externalId: 'T1110.001', name: 'Password Guessing', parentTechniqueId: T1110 }],
  ]),
  edges: [edge(CAP_IDP, T1110), edge(CAP_PAM, T1110)],
  protectedFamilies: [{ capabilityId: CAP_IDP, categoryId: 'web_application' }, { capabilityId: CAP_PAM, categoryId: 'identity' }],
  platformControls: [{ platformTypeKey: 'ISPM', capabilityId: CAP_IDP }],
  postures: [],
  capabilities: [{ id: CAP_IDP, externalId: 'IDP', name: 'Identity Platform' }, { id: CAP_PAM, externalId: 'PAM', name: 'Privileged Access Management' }],
  rows: [],
  fleet: { tallies: [], coverage: [] },
  ...overrides,
});

const tally = (overrides: Partial<FleetTally>): FleetTally => ({
  techniqueId: T1110,
  platformTypeKey: 'ISPM',
  expectationType: 'prevention',
  held: 1,
  total: 1,
  lastRunAt: new Date('2026-09-27T12:00:00Z'),
  ...overrides,
});

const fleetOf = (folds: Partial<FleetFolds>, techniqueId: string = T1110, overrides: Partial<AssetProtectionInput> = {}) => {
  const [iam] = deriveAssetProtection(input({ fleet: { tallies: [], coverage: [], ...folds }, ...overrides }), CONTEXT);
  return iam.standsOn.find((technique) => technique.mitreTechniqueId === techniqueId)?.fleet;
};

describe('deriveAssetProtection', () => {
  it('lets an edge on the parent carry the control onto the sub-technique', () => {
    const [iam] = deriveAssetProtection(input({}), CONTEXT);

    expect(iam.assetTechniqueCount).toBe(2);
  });

  it('keeps a sub-technique result under the sub-technique, never under its parent too', () => {
    const [iam] = deriveAssetProtection(input({
      rows: [row({ mitreTechniqueId: T1110_001, parentTechniqueId: T1110 })],
    }), CONTEXT);

    expect(iam.standsOn.map((technique) => [technique.externalId, technique.here.prevention])).toEqual([
      ['T1110.001', { held: 1, total: 1 }],
      ['T1110', null],
    ]);
    expect(iam.testedHere?.prevention).toEqual({ held: 1, total: 1 });
  });

  describe('fleet', () => {
    it('sums the tallies of the families implementing the control, dated by the latest', () => {
      const latest = new Date('2026-09-29T12:00:00Z');
      const fleet = fleetOf({
        tallies: [tally({ held: 3, total: 4 }), tally({ platformTypeKey: 'XDR', held: 0, total: 2, lastRunAt: latest })],
        coverage: [{ techniqueId: T1110, pairs: [{ platformTypeKey: 'ISPM', expectationType: 'prevention' }], assetCount: 5 }],
      }, T1110, { platformControls: [{ platformTypeKey: 'ISPM', capabilityId: CAP_IDP }, { platformTypeKey: 'XDR', capabilityId: CAP_IDP }] });

      expect(fleet).toEqual({ prevention: { held: 3, total: 6 }, detection: null, lastRunAt: latest, assetCount: 5 });
    });

    it('ignores a family that does not implement the control, and a function its edge does not cover', () => {
      const fleet = fleetOf({
        tallies: [tally({ platformTypeKey: 'EDR' }), tally({ expectationType: 'detection' })],
        coverage: [
          { techniqueId: T1110, pairs: [{ platformTypeKey: 'EDR', expectationType: 'prevention' }], assetCount: 3 },
          { techniqueId: T1110, pairs: [{ platformTypeKey: 'ISPM', expectationType: 'detection' }], assetCount: 4 },
        ],
      });

      expect(fleet).toEqual({ prevention: null, detection: null, lastRunAt: null, assetCount: 0 });
    });

    it('counts an asset once whichever of its pairs the control counts', () => {
      const fleet = fleetOf({
        coverage: [{
          techniqueId: T1110,
          pairs: [{ platformTypeKey: 'ISPM', expectationType: 'prevention' }, { platformTypeKey: 'XDR', expectationType: 'prevention' }],
          assetCount: 2,
        }],
      }, T1110, { platformControls: [{ platformTypeKey: 'ISPM', capabilityId: CAP_IDP }, { platformTypeKey: 'XDR', capabilityId: CAP_IDP }] });

      expect(fleet?.assetCount).toBe(2);
    });

    it('lets the edge on the parent count the sub-technique results, kept under the sub-technique', () => {
      const fleet = fleetOf({ tallies: [tally({ techniqueId: T1110_001 })] }, T1110_001);

      expect(fleet?.prevention).toEqual({ held: 1, total: 1 });
      expect(fleetOf({ tallies: [tally({ techniqueId: T1110_001 })] })?.prevention).toBeNull();
    });
  });

  it('stops counting a technique the tenant removed from the control', () => {
    expect(deriveAssetProtection(input({ edges: [edge(CAP_IDP, T1110, 'removed')] }), CONTEXT)).toEqual([]);
  });

  it('skips the category gate on an unclassified asset', () => {
    const listed = deriveAssetProtection(input({ categoryId: 'generic_asset' }), CONTEXT);

    expect(listed.map((control) => [control.externalId, control.protectsAssetCategory])).toEqual([['IDP', true], ['PAM', true]]);
  });

  it('reads a control nobody declared as not assessed, on the undeclared default', () => {
    const [iam] = deriveAssetProtection(input({}), CONTEXT);

    expect(iam).toMatchObject({ assessed: false, strengthRung: 'L0', coverageBucket: 'L0' });
  });
});
