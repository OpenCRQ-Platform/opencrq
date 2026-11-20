import { uuidv7 } from 'uuidv7';
import type { CveEvidenceRow, ExpectationEvidenceRow } from '../openaev-types';
import type { InjectExpectationOutput, InjectExpectationResult, OpenaevCveRawRow, RelatedFindingOutput } from './openaev-legacy-types';
import { mapExpectationType } from '../openaev-mapping-utils';

const CVE_IDENTIFIER_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
const CVE_IDENTIFIER_SEARCH_PATTERN = /\bCVE-\d{4}-\d{4,}\b/i;
const NOT_VULNERABLE_STATUS_PATTERN = /\bnot[\s_-]*vulnerable\b/i;

/**
 * Aggregate InjectExpectationResults by security platform type.
 * For each platform type, take the best result (max score = not exposed wins).
 * If at least one result for that platform type has score >= expectedScore → isExposed = false.
 * Otherwise → isExposed = true.
 * Keys are trimmed so they line up with the family keys evidence rows are built on.
 */
export const aggregateByPlatformType = (
  results: Array<InjectExpectationResult>,
  expectedScore: number,
): Map<string, { isExposed: boolean }> => {
  const byPlatform = new Map<string, number>();

  for (const r of results) {
    const platform = r.sourcePlatform?.trim();
    if (!platform) {
      continue;
    }
    const score = r.score ?? 0;
    const best = byPlatform.get(platform) ?? -Infinity;
    if (score > best) {
      byPlatform.set(platform, score);
    }
  }

  const result = new Map<string, { isExposed: boolean }>();
  for (const [platform, bestScore] of byPlatform) {
    result.set(platform, { isExposed: bestScore < expectedScore });
  }
  return result;
};

const expectationExposureFromStatus = (status: string | null | undefined): boolean | null => {
  const normalized = status?.toUpperCase();
  if (normalized === 'SUCCESS') {
    return false;
  }
  if (normalized === 'FAILED') {
    return true;
  }
  // PENDING and unknown statuses are not actionable as exposed/non-exposed evidence.
  return null;
};

/**
 * The CVE identifier a `cve` or `vulnerability` finding names, normalised to uppercase.
 * `finding_type` is compared to the lowercase values the API serialises (`'cve'`,
 * `'vulnerability'`), not the Java constant names `searchFindings` filters on.
 *
 * Normalisation isn't cosmetic: `upsertCves` (`module/src/modules/cve/service.ts:140`) inserts
 * `cveId` verbatim, and `cve_tenantid_cveid_idx` is case-sensitive, so a lowercase value would
 * create a parallel `cve` row that `cve-nist`, `cve-cisa` and `cve-first` would never enrich.
 */
export const cveIdentifierOf = (finding: RelatedFindingOutput): string | null => {
  const type = finding.finding_type?.toLowerCase();
  const value = finding.finding_value?.trim();
  if (!value) {
    return null;
  }
  if (type === 'cve') {
    return CVE_IDENTIFIER_PATTERN.test(value) ? value.toUpperCase() : null;
  }
  if (type === 'vulnerability') {
    // `finding_value` is `name + " [" + status + "]"` (VulnerabilityOutputProcessor.toFindingValue),
    // and both halves are free text, so the flattened value cannot be split back apart with
    // certainty. Take everything before the FIRST `[` — the shortest name the value can carry — so
    // that no part of the status is ever read as a name: a CVE named in the status usually says the
    // opposite of an exposure ("Missing patch [CVE-2021-1234 not detected]"). The cost is a CVE
    // missed when the name hides it behind brackets of its own, which errs on the safe side.
    // The status is free text too, but `not vulnerable` is OpenAEV's own expectation-side verdict
    // for "no exposure"; any other status, unknown included, stays an exposure.
    const firstBracket = value.indexOf('[');
    const name = firstBracket === -1 ? value : value.slice(0, firstBracket);
    if (firstBracket !== -1 && NOT_VULNERABLE_STATUS_PATTERN.test(value.slice(firstBracket))) {
      return null;
    }
    const match = name.match(CVE_IDENTIFIER_SEARCH_PATTERN);
    return match ? match[0].toUpperCase() : null;
  }
  return null;
};

/**
 * Splits raw CVE rows into chunks of at most `assetsPerChunk` assets, an asset's rows never split
 * across two. One chunk is one write transaction, and two findings reporting the same (asset, CVE)
 * pair must reach the same `bulkUpsertEvidence` call: the finding's state is derived after each
 * call, so a split would write the state one of them argues for alone before the other arrives.
 */
export const chunkCveRowsByAsset = (
  rows: ReadonlyArray<OpenaevCveRawRow>,
  assetsPerChunk: number,
): Array<Array<OpenaevCveRawRow>> => {
  const byAsset = new Map<string, Array<OpenaevCveRawRow>>();
  for (const row of rows) {
    const bucket = byAsset.get(row.supportingAssetId);
    if (bucket) {
      bucket.push(row);
    } else {
      byAsset.set(row.supportingAssetId, [row]);
    }
  }
  const chunks: Array<Array<OpenaevCveRawRow>> = [];
  let current: Array<OpenaevCveRawRow> = [];
  let assetsInCurrent = 0;
  for (const assetRows of byAsset.values()) {
    if (assetsInCurrent === assetsPerChunk) {
      chunks.push(current);
      current = [];
      assetsInCurrent = 0;
    }
    current.push(...assetRows);
    assetsInCurrent++;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
};

/** Flattens CVE findings into one row per (CVE, asset) pair; findings with no CVE identifier are skipped. */
export const collectCveRawRows = (cveFindings: Array<RelatedFindingOutput>): Array<OpenaevCveRawRow> => {
  const rows: Array<OpenaevCveRawRow> = [];
  for (const finding of cveFindings) {
    const cveIdentifier = cveIdentifierOf(finding);
    if (!cveIdentifier) {
      continue;
    }
    for (const assetRef of finding.finding_assets) {
      rows.push({
        cveIdentifier,
        supportingAssetId: assetRef.asset_id,
        findingId: finding.finding_id,
        injectId: finding.finding_inject?.inject_id ?? null,
        simulationId: finding.finding_simulation?.exercise_id ?? null,
        simulationName: finding.finding_simulation?.exercise_name ?? null,
        findingUpdatedAt: finding.finding_updated_at ?? null,
      });
    }
  }
  return rows;
};

/**
 * Builds one evidence row per (expectation × resolved MITRE technique × security platform type).
 * Expectations with an unresolved asset, an inject with no cached attack patterns, or an
 * unrecognised expectation type are skipped. Techniques not found locally are reported via
 * `onSkippedTechnique` and skipped (evidence can't reference a technique we don't know about).
 * Each family's `isExposed` compares that family's best score against the expected score. The
 * global expectation status only gates finality (PENDING skips the expectation) and backs the
 * fallback when the expected score is null or the family has no scored results.
 */
export const buildExpectationEvidenceRows = (params: {
  relevant: Array<InjectExpectationOutput>,
  assetIdMap: Map<string, string>,
  exerciseInjectPatterns: Map<string, Array<string>>,
  injectTitleMap: Map<string, string | null>,
  techniqueIdMap: Map<string, string>,
  scenarioId: string,
  scenarioName: string | null,
  exerciseId: string,
  exerciseUpdatedAt: string | null,
  exerciseName: string | null,
  connectorId: string,
  onSkippedTechnique?: (externalId: string) => void,
}): Array<ExpectationEvidenceRow> => {
  const {
    relevant,
    assetIdMap,
    exerciseInjectPatterns,
    injectTitleMap,
    techniqueIdMap,
    scenarioId,
    scenarioName,
    exerciseId,
    exerciseUpdatedAt,
    exerciseName,
    connectorId,
    onSkippedTechnique,
  } = params;
  const rows: Array<ExpectationEvidenceRow> = [];
  const simulationLabel = exerciseName ?? exerciseId;

  for (const exp of relevant) {
    const supportingAssetId = assetIdMap.get(exp.inject_expectation_asset!);
    if (!supportingAssetId) {
      continue;
    }
    const externalIds = exerciseInjectPatterns.get(exp.inject_expectation_inject!) ?? [];
    if (externalIds.length === 0) {
      continue;
    }
    const expectationType = mapExpectationType(exp.inject_expectation_type);
    if (!expectationType) {
      continue;
    }
    const statusExposure = expectationExposureFromStatus(exp.inject_expectation_status);
    if (statusExposure === null) {
      continue;
    }
    const expectedScore = exp.inject_expectation_expected_score;
    const familyVerdicts = expectedScore == null
      ? new Map<string, { isExposed: boolean }>()
      : aggregateByPlatformType(exp.inject_expectation_results, expectedScore);

    const platformTypes = [...new Set(
      exp.inject_expectation_results
        .map((result) => result.sourcePlatform?.trim())
        .filter((platform): platform is string => !!platform),
    )];
    const resolvedPlatformTypes = platformTypes.length > 0 ? platformTypes : ['unknown'];
    const injectTitle = injectTitleMap.get(exp.inject_expectation_inject!) ?? null;

    for (const externalId of externalIds) {
      const mitreTechniqueId = techniqueIdMap.get(externalId);
      if (!mitreTechniqueId) {
        onSkippedTechnique?.(externalId);
        continue;
      }
      for (const securityPlatformType of resolvedPlatformTypes) {
        const isExposed = familyVerdicts.get(securityPlatformType)?.isExposed ?? statusExposure;
        const verb = expectationType === 'prevention'
          ? (isExposed ? 'Not prevented' : 'Prevented')
          : (isExposed ? 'Not detected' : 'Detected');
        const reason = `${verb} by ${securityPlatformType} in simulation ${simulationLabel}${injectTitle ? ` (inject: ${injectTitle})` : ''}`;
        rows.push({
          id: uuidv7(),
          supportingAssetId,
          cveId: null,
          mitreTechniqueId,
          expectationType,
          isExposed,
          securityPlatformType,
          evaluatedAt: exerciseUpdatedAt ? new Date(exerciseUpdatedAt) : new Date(),
          sourceScenarioId: scenarioId,
          sourceScenarioName: scenarioName,
          sourceSimulationId: exerciseId,
          sourceInjectId: exp.inject_expectation_inject!,
          connectorId,
          sourceFindingId: `scenario-${scenarioId}`,
          scope: scenarioId,
          reason,
        });
      }
    }
  }

  return rows;
};

/**
 * Builds one evidence row per raw CVE row whose CVE and asset were both successfully resolved to a
 * UUID. The source is keyed and scoped by the id OpenAEV gives the asset, as on the snapshot path.
 */
export const buildCveEvidenceRows = (params: {
  rawCveRows: Array<OpenaevCveRawRow>,
  cveIdMap: Map<string, string>,
  cveAssetIdMap: Map<string, string>,
  connectorId: string,
}): Array<CveEvidenceRow> => {
  const { rawCveRows, cveIdMap, cveAssetIdMap, connectorId } = params;
  const rows: Array<CveEvidenceRow> = [];

  for (const row of rawCveRows) {
    const cveUuid = cveIdMap.get(row.cveIdentifier);
    if (!cveUuid) {
      continue;
    }
    const supportingAssetId = cveAssetIdMap.get(row.supportingAssetId);
    if (!supportingAssetId) {
      continue;
    }
    // An atomic test (no exercise) leaves `simulationId` null, so the reason drops "in
    // simulation" rather than naming a simulation that doesn't exist.
    const reason = row.simulationId
      ? `Reported by OpenAEV in simulation ${row.simulationName ?? row.simulationId}`
      : 'Reported by OpenAEV';
    rows.push({
      id: uuidv7(),
      supportingAssetId,
      cveId: cveUuid,
      mitreTechniqueId: null,
      expectationType: null,
      isExposed: true,
      securityPlatformType: null,
      evaluatedAt: row.findingUpdatedAt ? new Date(row.findingUpdatedAt) : new Date(),
      // A CVE is a property of the machine, so the scenario stays out of the canonical identity
      // and OpenAEV lands on the same row as any other scanner reporting it.
      sourceScenarioId: null,
      sourceScenarioName: null,
      sourceSimulationId: row.simulationId,
      sourceInjectId: row.injectId,
      connectorId,
      // Stable across replays, unlike OpenAEV's own finding id, which is new every run.
      sourceFindingId: `${row.supportingAssetId}:${row.cveIdentifier}`,
      // That volatile id, kept out of the key but refreshed here, is what the deep link needs.
      externalReference: row.findingId,
      scope: row.supportingAssetId,
      reason,
    });
  }

  return rows;
};
