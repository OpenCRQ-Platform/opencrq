import { describe, expect, it } from 'vitest';
import type { ImpactContributionView } from './impact-explanation-utils';
import { dependentShare, hopTargets, impactExplanationShape, primaryAssetPart } from './impact-explanation-utils';

const CAE = { id: 'cae', name: 'Card Authorization Engine', derivedName: null };
const AKS = { id: 'aks', name: 'Kubernetes Platform (AKS)', derivedName: null };

const contribution = (overrides: Partial<ImpactContributionView>): ImpactContributionView => ({
  primaryAssetId: 'ctd',
  primaryAssetName: 'Card Transaction Data',
  hops: 0,
  chain: [],
  roles: ['reads'],
  criteria: { availability: 'lower', integrity: 'lower', confidentiality: 'full', traceability: 'none' },
  outcomeTotal: 2.5,
  transmittedTotal: 1.75,
  share: 0.7,
  contribution: 0.35,
  ...overrides,
});

describe('impactExplanationShape', () => {
  it('explains one link to one primary asset as direct', () => {
    expect(impactExplanationShape([contribution({})]).kind).toBe('direct');
  });

  it('explains paths through one chain as transitive', () => {
    const shape = impactExplanationShape([
      contribution({ hops: 1, chain: [CAE] }),
      contribution({ primaryAssetId: 'cp', hops: 1, chain: [CAE] }),
    ]);

    expect(shape).toMatchObject({ kind: 'transitive', chain: [CAE], hops: 1 });
  });

  it('composes a section per primary asset when the paths differ', () => {
    expect(impactExplanationShape([
      contribution({}),
      contribution({ primaryAssetId: 'cp', hops: 1, chain: [CAE] }),
    ]).kind).toBe('mixed');
    expect(impactExplanationShape([contribution({}), contribution({ primaryAssetId: 'cp' })]).kind).toBe('mixed');
  });
});

describe('hopTargets', () => {
  it('walks the chain back up to the asset explained', () => {
    const azure = { id: 'az', name: 'Azure Cloud Subscription', derivedName: null };

    expect(hopTargets(azure, [AKS, CAE])).toEqual([AKS, azure]);
    expect(hopTargets(AKS, [CAE])).toEqual([AKS]);
  });
});

describe('figures', () => {
  it('reads the dependent\'s share one hop down and a primary asset\'s part of the loss', () => {
    expect(dependentShare(0.5)).toBe(1);
    expect(primaryAssetPart(contribution({ share: 1 }), 2)).toBe(0.5);
  });
});
