import { assetEnumerations, assetEvidence, assetEvidenceHistory, assetEvidenceSources, assetEvidenceVerdicts } from '../../modules/supporting-assets/schema';
import { ACME_EXPECTATION_FINDING_SPECS } from '../data/acme-expectation-findings';
import { ACME_FINDING_SPECS } from '../data/acme-findings';
import {
  assetExpectationFindingHistoryId,
  assetExpectationFindingId,
  assetExpectationFindingSourceId,
  assetFindingHistoryId,
  assetFindingId,
  assetFindingSourceId,
  IntegrationSetting_AcmeMicrosoftGraph,
  IntegrationSetting_AcmeOpenaev,
  Tenant_Acme,
  User_Alice,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * 86_400_000);

/**
 * When the vulnerability scanner last spoke about a finding it reported.
 *
 * A scanner re-reports an open flaw on every sync without changing its state, so the date a finding
 * was last seen is the last sync and never the day its state last moved. The two are separate
 * readings, and a seed giving them one value makes every finding read as seen exactly once.
 */
const LAST_SYNC_DAYS_AGO = 1;

registerPlatformSeed('asset-findings', async ({ db, services, now }) => {
  const evidenceRows: Array<typeof assetEvidence.$inferInsert> = [];
  const evidenceSourceRows: Array<typeof assetEvidenceSources.$inferInsert> = [];
  const historyRows: Array<typeof assetEvidenceHistory.$inferInsert> = [];
  const verdictRows: Array<typeof assetEvidenceVerdicts.$inferInsert> = [];
  // The scanner's last walk of each asset it reports on: what it left out then reads as no longer reported.
  const lastWalkAt = daysAgo(now, LAST_SYNC_DAYS_AGO);
  const walkedAssetIds = new Set<string>();

  ACME_FINDING_SPECS.forEach((spec, index) => {
    const evidenceId = assetFindingId(index);
    const createdAt = daysAgo(now, spec.createdDaysAgo);
    let lastChangeAt = createdAt;

    historyRows.push({
      id: assetFindingHistoryId(index, 0),
      tenantId: Tenant_Acme,
      assetEvidenceId: evidenceId,
      stateChangedAt: createdAt,
      state: 'applicable',
      reason: null,
      changedByUserId: spec.source === 'user' ? User_Alice : null,
      origin: spec.source === 'user' ? 'user' : 'exposed',
      observedAt: spec.source === 'user' ? null : createdAt,
    });

    if (spec.dismissal) {
      const dismissedAt = daysAgo(now, spec.createdDaysAgo - spec.dismissal.daysAfterCreation);
      lastChangeAt = dismissedAt;
      const decision = spec.dismissal.decision;
      historyRows.push({
        id: assetFindingHistoryId(index, 1),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        stateChangedAt: dismissedAt,
        state: 'dismissed',
        reason: decision?.reason ?? 'No longer reported by Microsoft Defender',
        dismissalType: decision?.type ?? null,
        dismissalReasonCode: decision?.reasonCode ?? null,
        changedByUserId: decision === undefined ? null : User_Alice,
        origin: decision === undefined ? 'no_longer_reported' : 'user',
        observedAt: decision === undefined ? dismissedAt : null,
      });

      if (spec.reopenedDaysAfterDismissal !== undefined) {
        const reopenedAt = daysAgo(
          now,
          spec.createdDaysAgo - spec.dismissal.daysAfterCreation - spec.reopenedDaysAfterDismissal,
        );
        lastChangeAt = reopenedAt;
        historyRows.push({
          id: assetFindingHistoryId(index, 2),
          tenantId: Tenant_Acme,
          assetEvidenceId: evidenceId,
          stateChangedAt: reopenedAt,
          state: 'applicable',
          reason: 'Detected again by the connector after remediation drift.',
          changedByUserId: null,
          origin: 'exposed',
          observedAt: reopenedAt,
        });
      }
    }

    // An auto-dismissal (no decision, never reopened) means the connector stopped reporting the
    // finding: its last report precedes the walk that left it out, or the retirement pass would read
    // its source as still reporting and reopen it.
    const isConnectorAutoDismissedForGood = spec.dismissal !== undefined
      && spec.dismissal.decision === undefined
      && spec.reopenedDaysAfterDismissal === undefined;
    const lastReportedAt = isConnectorAutoDismissedForGood
      ? new Date(Math.min(lastChangeAt.getTime(), lastWalkAt.getTime() - 60_000))
      : lastWalkAt;

    evidenceRows.push({
      id: evidenceId,
      supportingAssetId: spec.assetId,
      tenantId: Tenant_Acme,
      cveId: spec.cveRowId,
      userId: spec.source === 'user' ? User_Alice : null,
      evaluatedAt: spec.source === 'connector' ? lastReportedAt : null,
      createdAt,
      updatedAt: lastChangeAt,
    });
    if (spec.source === 'connector') {
      const sourceFindingId = `defender-finding-${String(index + 1).padStart(4, '0')}`;
      verdictRows.push({
        id: assetFindingHistoryId(index, 0),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        connectorId: IntegrationSetting_AcmeMicrosoftGraph,
        sourceFindingId,
        isExposed: true,
        observedAt: createdAt,
        recordedAt: createdAt,
      });
      walkedAssetIds.add(spec.assetId);
      evidenceSourceRows.push({
        id: assetFindingSourceId(index),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        connectorId: IntegrationSetting_AcmeMicrosoftGraph,
        sourceFindingId,
        isExposed: true,
        firstSeenAt: createdAt,
        lastSeenAt: lastReportedAt,
        lastReportedAt,
        evaluatedAt: lastReportedAt,
      });
    }
  });

  ACME_EXPECTATION_FINDING_SPECS.forEach((spec, index) => {
    const evidenceId = assetExpectationFindingId(index);
    const createdAt = daysAgo(now, spec.createdDaysAgo);
    let lastChangeAt = createdAt;
    // This seeder never reopens a dismissed expectation, so a dismissal here is always for good:
    // its source's last real report is the dismissal itself, exactly like the connector CVEs above.
    const isDismissedForGood = spec.dismissalDaysAfterCreation !== undefined;

    historyRows.push({
      id: assetExpectationFindingHistoryId(index, 0),
      tenantId: Tenant_Acme,
      assetEvidenceId: evidenceId,
      stateChangedAt: createdAt,
      state: 'applicable',
      reason: null,
      changedByUserId: null,
      origin: 'exposed',
      observedAt: createdAt,
    });
    verdictRows.push({
      id: assetExpectationFindingHistoryId(index, 0),
      tenantId: Tenant_Acme,
      assetEvidenceId: evidenceId,
      connectorId: IntegrationSetting_AcmeOpenaev,
      sourceFindingId: `scenario-${spec.sourceScenarioId}`,
      isExposed: true,
      observedAt: createdAt,
      recordedAt: createdAt,
    });

    if (spec.dismissalDaysAfterCreation !== undefined) {
      const dismissedAt = daysAgo(now, spec.createdDaysAgo - spec.dismissalDaysAfterCreation);
      lastChangeAt = dismissedAt;
      historyRows.push({
        id: assetExpectationFindingHistoryId(index, 1),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        stateChangedAt: dismissedAt,
        state: 'dismissed',
        reason: 'Automatically marked as prevented on latest simulation run.',
        changedByUserId: null,
        origin: 'not_exposed',
        observedAt: dismissedAt,
      });
      verdictRows.push({
        id: assetExpectationFindingHistoryId(index, 1),
        tenantId: Tenant_Acme,
        assetEvidenceId: evidenceId,
        connectorId: IntegrationSetting_AcmeOpenaev,
        sourceFindingId: `scenario-${spec.sourceScenarioId}`,
        isExposed: false,
        observedAt: dismissedAt,
        recordedAt: dismissedAt,
      });
    }

    evidenceRows.push({
      id: evidenceId,
      supportingAssetId: spec.assetId,
      tenantId: Tenant_Acme,
      cveId: null,
      mitreTechniqueId: spec.techniqueId,
      expectationType: spec.expectationType,
      securityPlatformType: spec.securityPlatformType,
      evaluatedAt: lastChangeAt,
      sourceScenarioId: spec.sourceScenarioId,
      sourceScenarioName: spec.sourceScenarioName,
      sourceSimulationId: spec.sourceSimulationId,
      sourceInjectId: spec.sourceInjectId,
      userId: null,
      createdAt,
      updatedAt: lastChangeAt,
    });
    // Matches the runtime ingestion key exactly (`buildAttackEvidenceRows`), so a real sync
    // against this seed refreshes this row instead of inserting a second beside it.
    const lastReportedAt = isDismissedForGood ? lastChangeAt : daysAgo(now, LAST_SYNC_DAYS_AGO);
    evidenceSourceRows.push({
      id: assetExpectationFindingSourceId(index),
      tenantId: Tenant_Acme,
      assetEvidenceId: evidenceId,
      connectorId: IntegrationSetting_AcmeOpenaev,
      sourceFindingId: `scenario-${spec.sourceScenarioId}`,
      scope: spec.sourceScenarioId,
      isExposed: !isDismissedForGood,
      firstSeenAt: createdAt,
      lastSeenAt: lastReportedAt,
      lastReportedAt,
      evaluatedAt: lastChangeAt,
    });
  });

  await db.insert(assetEvidence).values(evidenceRows);
  await db.insert(assetEvidenceSources).values(evidenceSourceRows);
  await db.insert(assetEvidenceHistory).values(historyRows);
  await db.insert(assetEvidenceVerdicts).values(verdictRows);
  await db.insert(assetEnumerations).values([...walkedAssetIds].map((supportingAssetId) => ({
    tenantId: Tenant_Acme,
    connectorId: IntegrationSetting_AcmeMicrosoftGraph,
    supportingAssetId,
    scope: '',
    lastReportedAt: lastWalkAt,
  })));

  // The rows above go straight to the database, so the finding write path never resolved them.
  await services.withOrigin({ type: 'system' }).techniqueMapping.resolveTechniquesForCves(
    [...new Set(ACME_FINDING_SPECS.map((spec) => spec.cveRowId))],
  );
});
