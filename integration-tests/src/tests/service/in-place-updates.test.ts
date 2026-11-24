import type { EventOrigin } from '@app/module';
import { cveSourceObservations } from '@app/module';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { findingScoreFixtures } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const LATER = '\'2100-01-01\'';

/**
 * Each table the syncs and the score recompute rewrite, with a write moving the columns they move
 * to values no fixture holds: an index on any of them would make that write leave its page.
 */
const SYNC_WRITES: Record<string, string> = {
  asset_evidence: `evaluated_at = ${LATER}, updated_at = ${LATER}`,
  asset_evidence_sources: `scope = 'changed', is_exposed = NOT is_exposed, reason = 'changed', external_reference = 'changed',
    reported_severity = 'changed', first_seen_at = ${LATER}, last_seen_at = ${LATER}, last_reported_at = ${LATER},
    evaluated_at = ${LATER}, updated_at = ${LATER}`,
  cve: `cvss = 1.5, cvss_vector = 'changed', cvss_updated_at = ${LATER}, epss = 0.123, epss_updated_at = ${LATER},
    kev = NOT coalesce(kev, false), kev_updated_at = ${LATER}, cve_title = 'changed', cve_description = 'changed', updated_at = ${LATER}`,
  cve_source_observations: `cvss = 1.5, cvss_vector = 'changed', cvss_updated_at = ${LATER}, epss = 0.123, epss_updated_at = ${LATER},
    kev = NOT coalesce(kev, false), kev_updated_at = ${LATER}, last_modified_at = ${LATER}, updated_at = ${LATER}`,
  finding_scores: `score = 1.5, band = 'low', exploitability = 0.123, impact = 0.123, potential_impact = 0.123,
    exploitation_let_through = 0.123, impact_let_through = 0.123, reachability = 0.123, threat = 0.123, score_changed_at = ${LATER}`,
  // Not `score`, which the unique findings list sorts on through `unique_finding_scores_scope_score_idx`.
  unique_finding_scores: 'band = \'low\', worst_score = 1.5, affected_asset_count = affected_asset_count + 1',
};

describe('Tables the syncs rewrite', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;

  const { attachCve, attachTechnique, createAsset, createConnector, insertCve } = findingScoreFixtures(services, db, () => ({ origin: adminOrigin, tenantId: adminTenantId, userId: adminUserId }));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  it('should keep room on their pages, and on no other table', async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND coalesce(c.reloptions, '{}') @> ARRAY['fillfactor=70']
    `);

    expect(result.rows.map((row) => row.table_name).toSorted()).toEqual(Object.keys(SYNC_WRITES).toSorted());
  });

  it.each(Object.entries(SYNC_WRITES))('should update %s in place when a sync moves the columns it writes', async (table, set) => {
    const asset = await createAsset('Edge gateway');
    const flaw = await insertCve('CVE-2026-0001', { epss: 0.5 });
    await attachCve(asset, flaw);
    await attachTechnique(asset, new Date(), await createConnector());
    await db.insert(cveSourceObservations).values([{ tenantId: adminTenantId, cveId: flaw, source: 'first', epss: 0.5 }]);
    await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

    const counts = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`UPDATE ${table} SET ${set}`));
      const { rows: [row] } = await tx.execute<{ updated: string, hot: string }>(sql`
        SELECT pg_stat_get_xact_tuples_updated(${table}::regclass) AS updated, pg_stat_get_xact_tuples_hot_updated(${table}::regclass) AS hot
      `);
      return row;
    });

    expect(Number(counts.updated)).toBeGreaterThan(0);
    expect(counts.hot).toBe(counts.updated);
  });
});
