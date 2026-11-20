import { describe, expect, it, vi } from 'vitest';
import type { CurrentObservation, RetirementServices } from './openaev-retirement';
import { retireAttackEvidence, retireCveEvidence } from './openaev-retirement';

const SINCE = new Date('2026-10-06T10:00:00.000Z');
const NOW = new Date('2026-10-06T12:00:00.000Z');
const CONNECTOR_ID = 'connector-1';
const REASON = 'No longer reported by OpenAEV';

const makeCurrent = (overrides: Partial<CurrentObservation> = {}): CurrentObservation => ({
  sourceAssetId: 'asset-1',
  scenarioId: 'scenario-1',
  attackPatternExternalId: 'T1110.001',
  expectationType: 'DETECTION',
  evidencePlatformTypes: ['EDR'],
  ...overrides,
});

const makeSvc = (current: Array<CurrentObservation> = []) => ({
  openaevConnector: {
    findCurrentObservations: vi.fn<RetirementServices['openaevConnector']['findCurrentObservations']>().mockResolvedValue(current),
  },
  supportingAssets: {
    markAssetsEnumerated: vi.fn<RetirementServices['supportingAssets']['markAssetsEnumerated']>().mockResolvedValue(undefined),
    refreshEvidenceSources: vi.fn<RetirementServices['supportingAssets']['refreshEvidenceSources']>().mockResolvedValue(0),
    markScopesEnumerated: vi.fn<RetirementServices['supportingAssets']['markScopesEnumerated']>().mockResolvedValue(undefined),
    recomputeEvidenceStateForAssets: vi.fn<RetirementServices['supportingAssets']['recomputeEvidenceStateForAssets']>().mockResolvedValue(0),
  },
  mitreAttack: {
    getTechniqueIdsByExternalIds: vi.fn<RetirementServices['mitreAttack']['getTechniqueIdsByExternalIds']>()
      .mockResolvedValue(new Map([['T1110.001', 'tech-1'], ['T1059', 'tech-2']])),
  },
});

const makeAttackDeps = (
  current: Array<CurrentObservation> = [],
  overrides: Partial<Parameters<typeof retireAttackEvidence>[0]> = {},
) => {
  const svc = makeSvc(current);
  const now = vi.fn(() => NOW);
  return {
    svc,
    now,
    deps: {
      svc,
      connectorId: CONNECTOR_ID,
      assetIdMap: new Map([['asset-1', 'sa-1'], ['asset-2', 'sa-2']]),
      mirrorPairs: [{ sourceAssetId: 'asset-1', scenarioId: 'scenario-1' }],
      extraScopePairs: [],
      now,
      ...overrides,
    },
  };
};

const enumerationsOf = (svc: ReturnType<typeof makeSvc>) =>
  svc.supportingAssets.markAssetsEnumerated.mock.calls.map(([input]) => ({ ...input, supportingAssetIds: [...input.supportingAssetIds].sort() }));

const judgedPairsOf = (svc: ReturnType<typeof makeSvc>) =>
  svc.openaevConnector.findCurrentObservations.mock.calls[0][0].pairs
    .map((pair) => `${pair.sourceAssetId}:${pair.scenarioId}`)
    .sort();

const noServiceCall = (svc: ReturnType<typeof makeSvc>) => {
  expect(svc.openaevConnector.findCurrentObservations).not.toHaveBeenCalled();
  expect(svc.supportingAssets.markAssetsEnumerated).not.toHaveBeenCalled();
  expect(svc.supportingAssets.refreshEvidenceSources).not.toHaveBeenCalled();
  expect(svc.supportingAssets.markScopesEnumerated).not.toHaveBeenCalled();
  expect(svc.supportingAssets.recomputeEvidenceStateForAssets).not.toHaveBeenCalled();
  expect(svc.mitreAttack.getTechniqueIdsByExternalIds).not.toHaveBeenCalled();
};

describe('retireAttackEvidence', () => {
  describe('enumeration', () => {
    it('enumerates the pairs at its own instant, taken once, one call per scope', async () => {
      const { svc, now, deps } = makeAttackDeps([makeCurrent()], {
        mirrorPairs: [
          { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' },
          { sourceAssetId: 'asset-2', scenarioId: 'scenario-1' },
          { sourceAssetId: 'asset-1', scenarioId: 'scenario-2' },
        ],
      });

      await retireAttackEvidence(deps);

      expect(enumerationsOf(svc)).toEqual(expect.arrayContaining([
        { connectorId: CONNECTOR_ID, supportingAssetIds: ['sa-1', 'sa-2'], scope: 'scenario-1', enumeratedAt: NOW },
        { connectorId: CONNECTOR_ID, supportingAssetIds: ['sa-1'], scope: 'scenario-2', enumeratedAt: NOW },
      ]));
      expect(svc.supportingAssets.markAssetsEnumerated).toHaveBeenCalledTimes(2);
      expect(now).toHaveBeenCalledTimes(1);
    });

    it('ignores a pair whose asset the registry does not know', async () => {
      const { svc, deps } = makeAttackDeps([], {
        mirrorPairs: [
          { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' },
          { sourceAssetId: 'asset-unknown', scenarioId: 'scenario-1' },
        ],
      });

      await retireAttackEvidence(deps);

      expect(enumerationsOf(svc)).toEqual([{ connectorId: CONNECTOR_ID, supportingAssetIds: ['sa-1'], scope: 'scenario-1', enumeratedAt: NOW }]);
      expect(judgedPairsOf(svc)).toEqual(['asset-1:scenario-1']);
    });

    it('enumerates and judges the extra scope pairs, which are already OpenCRQ ids, through the OpenAEV assets that map to them', async () => {
      const { svc, deps } = makeAttackDeps([], {
        assetIdMap: new Map([['asset-9', 'sa-9']]),
        mirrorPairs: [],
        extraScopePairs: [{ supportingAssetId: 'sa-9', scope: 'scenario-9' }],
      });

      await retireAttackEvidence(deps);

      expect(enumerationsOf(svc)).toEqual([{ connectorId: CONNECTOR_ID, supportingAssetIds: ['sa-9'], scope: 'scenario-9', enumeratedAt: NOW }]);
      expect(judgedPairsOf(svc)).toEqual(['asset-9:scenario-9']);
      expect(svc.supportingAssets.recomputeEvidenceStateForAssets).toHaveBeenCalledWith({ supportingAssetIds: ['sa-9'], reason: REASON });
    });

    it('judges nothing, and still enumerates, an extra scope pair no OpenAEV asset maps to', async () => {
      const { svc, deps } = makeAttackDeps([], {
        mirrorPairs: [],
        extraScopePairs: [{ supportingAssetId: 'sa-9', scope: 'scenario-9' }],
      });

      await retireAttackEvidence(deps);

      expect(enumerationsOf(svc)).toEqual([{ connectorId: CONNECTOR_ID, supportingAssetIds: ['sa-9'], scope: 'scenario-9', enumeratedAt: NOW }]);
      expect(svc.openaevConnector.findCurrentObservations).not.toHaveBeenCalled();
      expect(svc.supportingAssets.recomputeEvidenceStateForAssets).toHaveBeenCalledWith({ supportingAssetIds: ['sa-9'], reason: REASON });
    });

    it('enumerates a pair given by both the mirror and the extra pairs only once', async () => {
      const { svc, deps } = makeAttackDeps([], {
        extraScopePairs: [
          { supportingAssetId: 'sa-1', scope: 'scenario-1' },
          { supportingAssetId: 'sa-3', scope: 'scenario-1' },
        ],
      });

      await retireAttackEvidence(deps);

      expect(enumerationsOf(svc)).toEqual([
        { connectorId: CONNECTOR_ID, supportingAssetIds: ['sa-1', 'sa-3'], scope: 'scenario-1', enumeratedAt: NOW },
      ]);
    });

    it('enumerates a pair listed twice once', async () => {
      const pair = { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' };
      const { svc, deps } = makeAttackDeps([], { mirrorPairs: [pair, pair] });

      await retireAttackEvidence(deps);

      expect(enumerationsOf(svc)).toEqual([{ connectorId: CONNECTOR_ID, supportingAssetIds: ['sa-1'], scope: 'scenario-1', enumeratedAt: NOW }]);
    });

    it('enumerates before it refreshes, and refreshes before it recomputes', async () => {
      const order: Array<string> = [];
      const { svc, deps } = makeAttackDeps();
      svc.supportingAssets.markAssetsEnumerated.mockImplementation(() => {
        order.push('enumerate');
        return Promise.resolve();
      });
      svc.supportingAssets.refreshEvidenceSources.mockImplementation(() => {
        order.push('refresh');
        return Promise.resolve(0);
      });
      svc.supportingAssets.recomputeEvidenceStateForAssets.mockImplementation(() => {
        order.push('recompute');
        return Promise.resolve(0);
      });
      svc.openaevConnector.findCurrentObservations.mockResolvedValue([makeCurrent()]);

      await retireAttackEvidence(deps);

      expect(order).toEqual(['enumerate', 'refresh', 'recompute']);
    });
  });

  describe('folded OpenAEV assets', () => {
    it('judges a pair on the documents of every OpenAEV asset that maps to the same OpenCRQ asset', async () => {
      const { svc, deps } = makeAttackDeps([], {
        assetIdMap: new Map([['asset-1', 'sa-1'], ['asset-1b', 'sa-1'], ['asset-2', 'sa-2']]),
        mirrorPairs: [{ sourceAssetId: 'asset-1', scenarioId: 'scenario-1' }],
      });

      await retireAttackEvidence(deps);

      expect(judgedPairsOf(svc)).toEqual(['asset-1:scenario-1', 'asset-1b:scenario-1']);
    });

    it('keeps alive a technique only the other folded asset carries', async () => {
      const { svc, deps } = makeAttackDeps(
        [makeCurrent({ sourceAssetId: 'asset-1b', attackPatternExternalId: 'T1059' })],
        {
          assetIdMap: new Map([['asset-1', 'sa-1'], ['asset-1b', 'sa-1']]),
          mirrorPairs: [{ sourceAssetId: 'asset-1', scenarioId: 'scenario-1' }],
        },
      );

      await retireAttackEvidence(deps);

      expect(svc.supportingAssets.refreshEvidenceSources).toHaveBeenCalledWith({
        connectorId: CONNECTOR_ID,
        keys: [{ supportingAssetId: 'sa-1', scope: 'scenario-1', mitreTechniqueId: 'tech-2', expectationType: 'detection', securityPlatformTypes: ['EDR'] }],
        reportedAt: NOW,
      });
    });

    it('judges a pair once however many documents or folded assets lead to it', async () => {
      const { svc, deps } = makeAttackDeps([], {
        assetIdMap: new Map([['asset-1', 'sa-1'], ['asset-1b', 'sa-1']]),
        mirrorPairs: [
          { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' },
          { sourceAssetId: 'asset-1b', scenarioId: 'scenario-1' },
        ],
        extraScopePairs: [{ supportingAssetId: 'sa-1', scope: 'scenario-1' }],
      });

      await retireAttackEvidence(deps);

      expect(judgedPairsOf(svc)).toEqual(['asset-1:scenario-1', 'asset-1b:scenario-1']);
    });
  });

  describe('keeping the current documents alive', () => {
    it('refreshes a current document with the platform types its evidence was written with, at the instant it enumerated at', async () => {
      const { svc, deps } = makeAttackDeps([makeCurrent({ evidencePlatformTypes: ['EDR', 'SIEM'] })]);

      await retireAttackEvidence(deps);

      expect(svc.supportingAssets.refreshEvidenceSources).toHaveBeenCalledWith({
        connectorId: CONNECTOR_ID,
        keys: [{ supportingAssetId: 'sa-1', scope: 'scenario-1', mitreTechniqueId: 'tech-1', expectationType: 'detection', securityPlatformTypes: ['EDR', 'SIEM'] }],
        reportedAt: NOW,
      });
    });

    it('refreshes every current document, whenever its evidence was written', async () => {
      const { svc, deps } = makeAttackDeps([
        makeCurrent({ attackPatternExternalId: 'T1110.001' }),
        makeCurrent({ attackPatternExternalId: 'T1059' }),
      ]);

      await retireAttackEvidence(deps);

      const [{ keys }] = svc.supportingAssets.refreshEvidenceSources.mock.calls[0];
      expect(keys.map((key) => key.mitreTechniqueId).sort()).toEqual(['tech-1', 'tech-2']);
    });

    it.each([null, []])('does not refresh a current document whose evidence platform types are %j', async (evidencePlatformTypes) => {
      const { svc, deps } = makeAttackDeps([makeCurrent({ evidencePlatformTypes })]);

      await retireAttackEvidence(deps);

      expect(svc.supportingAssets.refreshEvidenceSources).not.toHaveBeenCalled();
      expect(svc.mitreAttack.getTechniqueIdsByExternalIds).not.toHaveBeenCalled();
      expect(svc.supportingAssets.recomputeEvidenceStateForAssets).toHaveBeenCalledOnce();
    });

    it('does not refresh what findCurrentObservations does not return, such as a superseded document', async () => {
      const { svc, deps } = makeAttackDeps([]);

      await retireAttackEvidence(deps);

      expect(svc.supportingAssets.refreshEvidenceSources).not.toHaveBeenCalled();
      expect(svc.supportingAssets.recomputeEvidenceStateForAssets).toHaveBeenCalledWith({ supportingAssetIds: ['sa-1'], reason: REASON });
    });

    it('resolves the expectation type, and gives each document the scenario as its scope', async () => {
      const { svc, deps } = makeAttackDeps(
        [
          makeCurrent({ expectationType: 'PREVENTION' }),
          makeCurrent({ sourceAssetId: 'asset-2', scenarioId: 'scenario-2' }),
        ],
        {
          mirrorPairs: [
            { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' },
            { sourceAssetId: 'asset-2', scenarioId: 'scenario-2' },
          ],
        },
      );

      await retireAttackEvidence(deps);

      const [{ keys }] = svc.supportingAssets.refreshEvidenceSources.mock.calls[0];
      expect(keys).toEqual([
        expect.objectContaining({ supportingAssetId: 'sa-1', scope: 'scenario-1', mitreTechniqueId: 'tech-1', expectationType: 'prevention' }),
        expect.objectContaining({ supportingAssetId: 'sa-2', scope: 'scenario-2', mitreTechniqueId: 'tech-1', expectationType: 'detection' }),
      ]);
    });

    it('lists a key shared by two documents once, with the union of their platform types', async () => {
      const { svc, deps } = makeAttackDeps([
        makeCurrent({ evidencePlatformTypes: ['EDR'] }),
        makeCurrent({ evidencePlatformTypes: ['EDR', 'SIEM'] }),
      ]);

      await retireAttackEvidence(deps);

      const [{ keys }] = svc.supportingAssets.refreshEvidenceSources.mock.calls[0];
      expect(keys).toHaveLength(1);
      expect([...keys[0].securityPlatformTypes].sort()).toEqual(['EDR', 'SIEM']);
    });

    it('skips a document whose technique is unknown or whose expectation type is not mapped', async () => {
      const { svc, deps } = makeAttackDeps([
        makeCurrent({ attackPatternExternalId: 'T9999' }),
        makeCurrent({ expectationType: 'MANUAL' }),
      ]);

      await retireAttackEvidence(deps);

      expect(svc.supportingAssets.refreshEvidenceSources).not.toHaveBeenCalled();
      expect(svc.supportingAssets.recomputeEvidenceStateForAssets).toHaveBeenCalledOnce();
    });

    it('resolves every technique in one call', async () => {
      const { svc, deps } = makeAttackDeps([
        makeCurrent({ attackPatternExternalId: 'T1110.001' }),
        makeCurrent({ attackPatternExternalId: 'T1059' }),
        makeCurrent({ attackPatternExternalId: 'T1059', expectationType: 'PREVENTION' }),
      ]);

      await retireAttackEvidence(deps);

      expect(svc.mitreAttack.getTechniqueIdsByExternalIds).toHaveBeenCalledOnce();
      expect(svc.mitreAttack.getTechniqueIdsByExternalIds.mock.calls[0][0].sort()).toEqual(['T1059', 'T1110.001']);
    });
  });

  describe('recompute', () => {
    it('recomputes every enumerated asset once, with the reason', async () => {
      const { svc, deps } = makeAttackDeps([], {
        mirrorPairs: [
          { sourceAssetId: 'asset-1', scenarioId: 'scenario-1' },
          { sourceAssetId: 'asset-1', scenarioId: 'scenario-2' },
          { sourceAssetId: 'asset-2', scenarioId: 'scenario-1' },
        ],
        extraScopePairs: [{ supportingAssetId: 'sa-9', scope: 'scenario-9' }],
      });

      await retireAttackEvidence(deps);

      expect(svc.supportingAssets.recomputeEvidenceStateForAssets).toHaveBeenCalledOnce();
      const [{ supportingAssetIds, reason }] = svc.supportingAssets.recomputeEvidenceStateForAssets.mock.calls[0];
      expect([...supportingAssetIds].sort()).toEqual(['sa-1', 'sa-2', 'sa-9']);
      expect(reason).toBe(REASON);
    });
  });

  describe('nothing to retire', () => {
    it('calls no service for empty pair lists', async () => {
      const { svc, now, deps } = makeAttackDeps([], { mirrorPairs: [], extraScopePairs: [] });

      await retireAttackEvidence(deps);

      noServiceCall(svc);
      expect(now).not.toHaveBeenCalled();
    });

    it('calls no service when every mirror pair is of an unknown asset', async () => {
      const { svc, deps } = makeAttackDeps([], {
        mirrorPairs: [{ sourceAssetId: 'asset-unknown', scenarioId: 'scenario-1' }],
      });

      await retireAttackEvidence(deps);

      noServiceCall(svc);
    });
  });
});

describe('retireCveEvidence', () => {
  const pairs = [
    { supportingAssetId: 'sa-1', scope: 'asset-a' },
    { supportingAssetId: 'sa-1', scope: 'asset-b' },
    { supportingAssetId: 'sa-2', scope: 'asset-c' },
  ];

  it('enumerates the pairs at the instant given, each under its own scope, then recomputes each asset once', async () => {
    const svc = makeSvc();

    await retireCveEvidence({ svc, connectorId: CONNECTOR_ID, pairs, enumeratedAt: SINCE });

    expect(svc.supportingAssets.markScopesEnumerated).toHaveBeenCalledOnce();
    expect(svc.supportingAssets.markScopesEnumerated).toHaveBeenCalledWith({ connectorId: CONNECTOR_ID, pairs, enumeratedAt: SINCE });
    expect(svc.supportingAssets.markAssetsEnumerated).not.toHaveBeenCalled();
    expect(svc.supportingAssets.recomputeEvidenceStateForAssets).toHaveBeenCalledOnce();
    const [{ supportingAssetIds, reason }] = svc.supportingAssets.recomputeEvidenceStateForAssets.mock.calls[0];
    expect([...supportingAssetIds].sort()).toEqual(['sa-1', 'sa-2']);
    expect(reason).toBe(REASON);
  });

  it('enumerates before it recomputes', async () => {
    const svc = makeSvc();
    const order: Array<string> = [];
    svc.supportingAssets.markScopesEnumerated.mockImplementation(() => {
      order.push('enumerate');
      return Promise.resolve();
    });
    svc.supportingAssets.recomputeEvidenceStateForAssets.mockImplementation(() => {
      order.push('recompute');
      return Promise.resolve(0);
    });

    await retireCveEvidence({ svc, connectorId: CONNECTOR_ID, pairs, enumeratedAt: SINCE });

    expect(order).toEqual(['enumerate', 'recompute']);
  });

  it('calls no service for an empty list of pairs', async () => {
    const svc = makeSvc();

    await retireCveEvidence({ svc, connectorId: CONNECTOR_ID, pairs: [], enumeratedAt: SINCE });

    noServiceCall(svc);
  });
});
