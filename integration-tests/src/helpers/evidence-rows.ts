import { assetEvidence, assetEvidenceHistory, assetEvidenceVerdicts, cve, mitreTechniques } from '@app/module';
import { desc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db } from '../setup/db';

/**
 * Every evidence row of an asset, as stored: the technique's attributes (platform type, scenario,
 * simulation) and the reason of the latest state change, none of which the findings tab lists.
 * Read straight from the tables so a test sees what a connector sync wrote, not what a screen shows.
 */
export const evidenceRowsOfAsset = async (supportingAssetId: string) => {
  const rows = await db
    .select({
      id: assetEvidence.id,
      cveId: cve.cveId,
      mitreTechniqueExternalId: mitreTechniques.externalId,
      expectationType: assetEvidence.expectationType,
      securityPlatformType: assetEvidence.securityPlatformType,
      evaluatedAt: assetEvidence.evaluatedAt,
      sourceScenarioId: assetEvidence.sourceScenarioId,
      sourceSimulationId: assetEvidence.sourceSimulationId,
    })
    .from(assetEvidence)
    .leftJoin(cve, eq(assetEvidence.cveId, cve.id))
    .leftJoin(mitreTechniques, eq(assetEvidence.mitreTechniqueId, mitreTechniques.id))
    .where(eq(assetEvidence.supportingAssetId, supportingAssetId));
  if (rows.length === 0) {
    return [];
  }
  const history = await db
    .select({ assetEvidenceId: assetEvidenceHistory.assetEvidenceId, state: assetEvidenceHistory.state, reason: assetEvidenceHistory.reason })
    .from(assetEvidenceHistory)
    .where(inArray(assetEvidenceHistory.assetEvidenceId, rows.map((row) => row.id)))
    .orderBy(desc(assetEvidenceHistory.stateChangedAt), desc(assetEvidenceHistory.id));
  const latest = new Map<string, { state: string, reason: string | null }>();
  for (const entry of history) {
    if (!latest.has(entry.assetEvidenceId)) {
      latest.set(entry.assetEvidenceId, { state: entry.state, reason: entry.reason });
    }
  }
  return rows.map((row) => ({
    ...row,
    currentState: latest.get(row.id)?.state ?? null,
    stateReason: latest.get(row.id)?.reason ?? null,
  }));
};

/**
 * What a sync records when a test moves a finding: the history row of the state it argues for and
 * the verdict behind it, both dated `at`. A test reading the state and one reading the test results
 * then see the same run.
 */
export const insertSyncedVerdict = async (
  evidenceId: string,
  state: 'applicable' | 'dismissed',
  at: Date,
  options: { reason?: string | null, connectorId?: string | null } = {},
): Promise<void> => {
  const [{ tenantId }] = await db.select({ tenantId: assetEvidence.tenantId }).from(assetEvidence).where(eq(assetEvidence.id, evidenceId));
  await db.insert(assetEvidenceHistory).values([{
    id: uuidv7(),
    tenantId,
    assetEvidenceId: evidenceId,
    state,
    stateChangedAt: at,
    observedAt: at,
    reason: options.reason ?? null,
    changedByUserId: null,
    origin: state === 'applicable' ? 'exposed' : 'not_exposed',
  }]);
  await db.insert(assetEvidenceVerdicts).values([{
    id: uuidv7(),
    tenantId,
    assetEvidenceId: evidenceId,
    connectorId: options.connectorId ?? null,
    isExposed: state === 'applicable',
    observedAt: at,
    recordedAt: at,
  }]);
};
