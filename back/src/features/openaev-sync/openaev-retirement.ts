import type { ExpectationType, ObservationPair } from '@app/module';
import { mapExpectationType } from './openaev-mapping-utils';
import { sourceAssetIdsBySupportingAsset } from './openaev-reconciliation-scope';

const RETIREMENT_REASON = 'No longer reported by OpenAEV';

/** The mirror columns the retirement reads, a subset of the row `findCurrentObservations` returns. */
export interface CurrentObservation {
  sourceAssetId: string,
  scenarioId: string,
  attackPatternExternalId: string,
  expectationType: string,
  /** The security platform types the document's evidence was last written with; `null` while none was. */
  evidencePlatformTypes: Array<string> | null,
}

export interface EvidenceSourceKey {
  supportingAssetId: string,
  scope: string,
  mitreTechniqueId: string,
  expectationType: ExpectationType,
  securityPlatformTypes: Array<string>,
}

/** An (OpenCRQ asset, scope) pair the connector holds evidence sources under. */
export interface ScopePair {
  supportingAssetId: string,
  scope: string,
}

/** The service methods the retirement calls, as plain functions so a test can hand them over as `vi.fn()`. */
export interface RetirementServices {
  openaevConnector: {
    findCurrentObservations: (input: { connectorId: string, pairs: Array<ObservationPair> }) => Promise<Array<CurrentObservation>>,
  },
  supportingAssets: {
    markAssetsEnumerated: (input: { connectorId: string, supportingAssetIds: Array<string>, scope: string, enumeratedAt: Date }) => Promise<void>,
    refreshEvidenceSources: (input: { connectorId: string, keys: Array<EvidenceSourceKey>, reportedAt: Date }) => Promise<number>,
    markScopesEnumerated: (input: { connectorId: string, pairs: Array<ScopePair>, enumeratedAt: Date }) => Promise<void>,
    recomputeEvidenceStateForAssets: (input: { supportingAssetIds: Array<string>, reason: string }) => Promise<number>,
  },
  mitreAttack: {
    getTechniqueIdsByExternalIds: (externalIds: Array<string>) => Promise<Map<string, string>>,
  },
}

export interface RetireAttackEvidenceDeps {
  svc: RetirementServices,
  connectorId: string,
  /** OpenAEV asset id to supporting asset id, for every OpenAEV asset the connector has registered. */
  assetIdMap: ReadonlyMap<string, string>,
  /** (OpenAEV asset, scenario) pairs whose mirror documents are judged; a pair whose asset the map does not know is ignored. */
  mirrorPairs: ReadonlyArray<ObservationPair>,
  /** Pairs already in OpenCRQ ids that are enumerated and judged like the mirror pairs. */
  extraScopePairs: ReadonlyArray<ScopePair>,
  now: () => Date,
}

/**
 * Retires the attack evidence a read no longer stands behind, over a set of (asset, scenario) pairs.
 *
 * The pairs to enumerate are the resolvable `mirrorPairs` plus `extraScopePairs`, each under its
 * scenario as scope, one `markAssetsEnumerated` call per scope. They are enumerated at an instant
 * of the retirement's own, taken once. Each is judged on the documents of every OpenAEV asset that
 * maps to its OpenCRQ asset, since several OpenAEV assets can be folded onto one. Every document
 * still current for those pairs (`findCurrentObservations`) has the sources of the platform types
 * its evidence was written with kept alive (`refreshEvidenceSources` at that same instant); a
 * document that wrote no evidence has none to keep. What stays older is a superseded or deleted
 * document, or a platform type a rewritten document no longer carries, and
 * `recomputeEvidenceStateForAssets` then dismisses it with the reason `No longer reported by
 * OpenAEV`. Nothing depends on when evidence was written, so the pairs may be judged in any run.
 *
 * Calls no service when there is no pair to enumerate.
 */
export const retireAttackEvidence = async (deps: RetireAttackEvidenceDeps): Promise<void> => {
  const { svc, connectorId, assetIdMap, now } = deps;

  const enumerated = new Map<string, ScopePair>();
  for (const pair of deps.mirrorPairs) {
    const supportingAssetId = assetIdMap.get(pair.sourceAssetId);
    if (supportingAssetId !== undefined) {
      enumerated.set(`${supportingAssetId}\u0000${pair.scenarioId}`, { supportingAssetId, scope: pair.scenarioId });
    }
  }
  for (const pair of deps.extraScopePairs) {
    enumerated.set(`${pair.supportingAssetId}\u0000${pair.scope}`, pair);
  }
  if (enumerated.size === 0) {
    return;
  }

  const retiredAt = now();
  for (const [scope, pairs] of Map.groupBy(enumerated.values(), (pair) => pair.scope)) {
    const supportingAssetIds = pairs.map((pair) => pair.supportingAssetId);
    await svc.supportingAssets.markAssetsEnumerated({ connectorId, supportingAssetIds, scope, enumeratedAt: retiredAt });
  }

  const sourceAssetIdsBySupportingAssetId = sourceAssetIdsBySupportingAsset(assetIdMap);
  const judgedPairs = new Map<string, ObservationPair>();
  for (const { supportingAssetId, scope } of enumerated.values()) {
    for (const sourceAssetId of sourceAssetIdsBySupportingAssetId.get(supportingAssetId) ?? []) {
      judgedPairs.set(`${sourceAssetId}\u0000${scope}`, { sourceAssetId, scenarioId: scope });
    }
  }

  if (judgedPairs.size > 0) {
    const current = await svc.openaevConnector.findCurrentObservations({ connectorId, pairs: [...judgedPairs.values()] });
    const written = current.filter((observation) => observation.evidencePlatformTypes !== null && observation.evidencePlatformTypes.length > 0);
    if (written.length > 0) {
      const techniqueIdMap = await svc.mitreAttack.getTechniqueIdsByExternalIds(
        [...new Set(written.map((observation) => observation.attackPatternExternalId))],
      );
      const keys = new Map<string, EvidenceSourceKey>();
      for (const observation of written) {
        const supportingAssetId = assetIdMap.get(observation.sourceAssetId);
        const mitreTechniqueId = techniqueIdMap.get(observation.attackPatternExternalId);
        const expectationType = mapExpectationType(observation.expectationType);
        if (supportingAssetId === undefined || mitreTechniqueId === undefined || expectationType === null) {
          continue;
        }
        const keyId = [supportingAssetId, observation.scenarioId, mitreTechniqueId, expectationType].join('\u0000');
        const securityPlatformTypes = new Set([...(keys.get(keyId)?.securityPlatformTypes ?? []), ...(observation.evidencePlatformTypes ?? [])]);
        keys.set(keyId, {
          supportingAssetId,
          scope: observation.scenarioId,
          mitreTechniqueId,
          expectationType,
          securityPlatformTypes: [...securityPlatformTypes],
        });
      }
      if (keys.size > 0) {
        await svc.supportingAssets.refreshEvidenceSources({ connectorId, keys: [...keys.values()], reportedAt: retiredAt });
      }
    }
  }

  await svc.supportingAssets.recomputeEvidenceStateForAssets({
    supportingAssetIds: [...new Set([...enumerated.values()].map((pair) => pair.supportingAssetId))],
    reason: RETIREMENT_REASON,
  });
};

export interface RetireCveEvidenceDeps {
  svc: RetirementServices,
  connectorId: string,
  /** The (asset, scope) pairs to enumerate: scope is the id OpenAEV gives the asset the CVE sources were reported for. */
  pairs: ReadonlyArray<ScopePair>,
  /** The instant the read began: what its sources were not reported since is what gets retired. */
  enumeratedAt: Date,
}

/**
 * Retires the CVE evidence an OpenAEV asset no longer reports: each pair is enumerated at
 * `enumeratedAt` under its own scope, so the CVEs OpenAEV stopped reporting for that asset alone are
 * dismissed by the recompute with the reason `No longer reported by OpenAEV`, and what another
 * OpenAEV asset folded onto the same OpenCRQ asset still reports stands. Calls no service when
 * there is no pair.
 */
export const retireCveEvidence = async (deps: RetireCveEvidenceDeps): Promise<void> => {
  const { svc, connectorId, pairs, enumeratedAt } = deps;
  if (pairs.length === 0) {
    return;
  }
  await svc.supportingAssets.markScopesEnumerated({ connectorId, pairs: [...pairs], enumeratedAt });
  await svc.supportingAssets.recomputeEvidenceStateForAssets({
    supportingAssetIds: [...new Set(pairs.map((pair) => pair.supportingAssetId))],
    reason: RETIREMENT_REASON,
  });
};
