import { decodeTriggerArgs, loadDoorbellParents } from '@app/module';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../setup/db';

/** The literal is here so a new tenant-through-parent trigger shows up as a reviewed diff. */
const DOORBELL_PARENT_COUNT = 48;

describe('doorbell topology', () => {
  it('should map every tenant-through-parent child to the parent its trigger names', async () => {
    const parents = await loadDoorbellParents(db);
    const byChild = new Map(parents.map(({ child, parent }) => [child, parent]));

    expect(byChild.get('threat_analysis_cves')).toBe('threat_analyses');
    expect(byChild.get('threat_analysis_attributions')).toBe('threat_analyses');
    expect(byChild.get('threat_analysis_threat_actor_types')).toBe('threat_analyses');
    expect(byChild.get('threat_analysis_roles')).toBe('threat_analyses');
    expect(byChild.get('scenario_loss_estimates')).toBe('risk_scenarios');
    expect(byChild.get('treatment_plans')).toBe('organizations');
    expect(byChild.get('crq_indicator_group_scores')).toBe('crq_indicator_runs');
    expect(byChild.get('crq_cve_what_if_results')).toBe('crq_indicator_runs');
    expect(byChild.get('control_capability_scope_overrides')).toBe('organizations');
    expect(byChild.get('organization_risk_tolerances')).toBe('organizations');
    expect(byChild.get('risk_scenario_risk_tolerances')).toBe('risk_scenarios');
    expect(byChild.get('budget_reviews')).toBe('organizations');
    for (const child of ['budget_review_lines', 'budget_review_line_controls', 'budget_review_closed_figures', 'budget_review_closed_postures', 'budget_review_closed_tolerances', 'crq_budget_review_results', 'crq_budget_review_annual_losses']) {
      expect(byChild.get(child), child).toBe('budget_reviews');
    }
    expect(byChild.has('tenants')).toBe(false);
    expect(byChild.has('asset_evidence_verdicts')).toBe(false);
    for (const table of ['primary_assets', 'support_to_primary_links', 'support_to_support_links', 'asset_evidence_sources', 'supporting_asset_tags']) {
      expect(byChild.has(table), table).toBe(false);
    }
    expect(parents).toHaveLength(DOORBELL_PARENT_COUNT);
  });

  it('should route each generic trigger along real foreign keys, and stop at the first table carrying the tenant', async () => {
    const triggers = await db.execute<{ child: string, fn: string, args: string | null }>(sql`
      SELECT c.relname AS child, p.proname AS fn, encode(t.tgargs, 'escape') AS args
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND p.proname IN ('notify_data_changed_tenant_via_fk', 'notify_data_changed_tenant_via_2hop_fk')
    `);
    const foreignKeys = await db.execute<{ child: string, column: string, parent: string }>(sql`
      SELECT src.relname AS child, a.attname AS column, dst.relname AS parent
      FROM pg_constraint k
      JOIN pg_class src ON src.oid = k.conrelid
      JOIN pg_class dst ON dst.oid = k.confrelid
      CROSS JOIN LATERAL unnest(k.conkey, k.confkey) AS u(col, ref_col)
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.col
      JOIN pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = u.ref_col
      WHERE k.contype = 'f' AND ra.attname = 'id'
    `);
    const tenantColumns = await db.execute<{ table: string }>(sql`
      SELECT table_name AS table FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'
    `);
    const edges = new Set(foreignKeys.rows.map(({ child, column, parent }) => `${child}.${column} -> ${parent}`));
    const carriesTenant = new Set(tenantColumns.rows.map(({ table }) => table));

    const faults: Array<string> = [];
    for (const { child, fn, args } of triggers.rows) {
      const [fk = '', parent = '', parentFk = '', grandparent = ''] = decodeTriggerArgs(args);
      const hops: Array<[string, string, string]> = fn === 'notify_data_changed_tenant_via_fk'
        ? [[child, fk, parent]]
        : [[child, fk, parent], [parent, parentFk, grandparent]];
      for (const [from, column, to] of hops) {
        if (!edges.has(`${from}.${column} -> ${to}`)) {
          faults.push(`${child}: no foreign key ${from}.${column} -> ${to}`);
        }
      }
      if (carriesTenant.has(child)) {
        faults.push(`${child}: carries tenant_id, notify_data_changed_tenant() needs no hop`);
      }
      const [, , tenantTable] = hops[hops.length - 1];
      if (!carriesTenant.has(tenantTable)) {
        faults.push(`${child}: ${tenantTable} carries no tenant_id`);
      }
      if (hops.length > 1 && carriesTenant.has(parent)) {
        faults.push(`${child}: ${parent} carries tenant_id, one hop is enough`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('should read the tenant of the run children from risk_scenarios, without a join to organizations', async () => {
    const functions = await db.execute<{ name: string, body: string }>(sql`
      SELECT proname AS name, prosrc AS body FROM pg_proc
      WHERE proname = 'notify_data_changed_tenant_via_crq_run'
    `);
    expect(functions.rows).toHaveLength(1);
    for (const { name, body } of functions.rows) {
      expect(body, name).toMatch(/\brisk_scenarios\b/);
      expect(body, name).not.toMatch(/\borganizations\b/);
    }
  });
});
