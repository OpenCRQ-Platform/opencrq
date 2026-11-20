import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ConnectorScopeKind } from './inventory';
import { DRATA_SOURCE } from '../controls/capability/constants';
import { defineRepository } from '../../registry';

const totalOf = async (query: PromiseLike<Array<{ total: number }>>): Promise<number> => {
  const rows = await query;
  return Number(rows[0]?.total ?? 0);
};

export const connectorsRepository = defineRepository({
  /**
   * One entity row per record, each table counted once however many connectors declare the kind:
   * an asset or a finding several connectors report is one record, not one per source.
   * Tables with a manual write path only count connector-written rows; `cve` has no origin column
   * but no user write path either, so all rows are connector-written. The OpenCTI mirror keeps a
   * deleted object as a tombstone until the rebuild has folded it, and a tombstone is no longer a
   * record the platform holds.
   */
  countIngestedRecords: async ({ db, views }, tenantId: string): Promise<number> => {
    const countByScopeKind: Record<ConnectorScopeKind, () => Promise<number>> = {
      cves: () => totalOf(db
        .select({ total: sql<number>`count(*)` })
        .from(views.cve)
        .where(eq(views.cve.tenantId, tenantId))),
      supporting_assets: () => totalOf(db
        .select({ total: sql<number>`count(distinct ${views.supportingAssetSources.supportingAssetId})` })
        .from(views.supportingAssetSources)
        .where(and(
          eq(views.supportingAssetSources.tenantId, tenantId),
          eq(views.supportingAssetSources.origin, 'connector'),
        ))),
      findings: () => totalOf(db
        .select({ total: sql<number>`count(distinct ${views.assetEvidenceSources.assetEvidenceId})` })
        .from(views.assetEvidenceSources)
        .where(eq(views.assetEvidenceSources.tenantId, tenantId))),
      // A derived value also pools published assessments, so only one Drata fed counts as ingested.
      capability_assessments: () => totalOf(db
        .select({ total: sql<number>`count(distinct ${views.controlCapabilityAssessmentSources.assessmentId})` })
        .from(views.controlCapabilityAssessmentSources)
        .where(and(
          eq(views.controlCapabilityAssessmentSources.tenantId, tenantId),
          eq(views.controlCapabilityAssessmentSources.source, DRATA_SOURCE),
        ))),
      threat_intelligence: () => totalOf(db
        .select({ total: sql<number>`count(*)` })
        .from(views.openctiStreamObjects)
        .where(and(
          eq(views.openctiStreamObjects.tenantId, tenantId),
          isNull(views.openctiStreamObjects.deletedAt),
        ))),
    };
    const totals = await Promise.all(Object.values(countByScopeKind).map((count) => count()));
    return totals.reduce((sum, value) => sum + value, 0);
  },
});
