import type { DrizzleDB } from '@app/module';
import { INTEGRATION_SOURCES, schema } from '@app/module';
import type { SQL } from 'drizzle-orm';
import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * Computed gauges: aggregate, cross-tenant totals only. Never per-tenant
 * breakdowns (tenant identity is customer data), no names, no content.
 *
 * Names carry no product prefix: the analytics warehouse adds it from the
 * collector the export reached, so renaming the product never renames a series.
 *
 * The optional `filter` restricts the count to a non-customer dimension
 * (a status, a connector source) - it must never slice by tenant or by any
 * customer-provided value.
 */
export interface CountGaugeDefinition {
  name: string,
  description: string,
  table: PgTable,
  filter?: SQL,
}

export const EDITION_GAUGE = {
  name: 'is_enterprise_edition',
  description: 'Whether the platform is an Enterprise Edition instance',
} as const;

export const COUNT_GAUGES: Array<CountGaugeDefinition> = [
  // Platform
  { name: 'total_users_count', description: 'Total number of users', table: schema.users },
  { name: 'service_accounts_count', description: 'Total number of service accounts', table: schema.serviceAccounts },
  { name: 'total_tenants_count', description: 'Total number of tenants', table: schema.tenants },
  { name: 'organizations_count', description: 'Total number of organizations', table: schema.organizations },
  { name: 'groups_count', description: 'Total number of groups', table: schema.groups },
  { name: 'roles_count', description: 'Total number of tenant roles', table: schema.roles },
  { name: 'platform_roles_count', description: 'Total number of platform roles', table: schema.platformRoles },
  // Controls and findings
  { name: 'control_capabilities_count', description: 'Total number of control capabilities', table: schema.controlCapabilities },
  { name: 'control_capability_assessments_count', description: 'Total number of capability assessments', table: schema.controlCapabilityAssessments },
  { name: 'findings_count', description: 'Total number of findings', table: schema.assetEvidence },
  // Risk / CRQ
  { name: 'risk_scenarios_count', description: 'Total number of risk scenarios', table: schema.riskScenarios },
  { name: 'crq_indicator_runs_count', description: 'Number of CRQ indicator runs stored; a result equal to the latest stores none, and retention thins the history past a year', table: schema.crqIndicatorRuns },
  { name: 'loss_drivers_count', description: 'Total number of loss drivers', table: schema.lossDrivers },
  { name: 'attack_outcomes_count', description: 'Total number of attack outcomes', table: schema.attackOutcomes },
  { name: 'scenario_loss_estimates_count', description: 'Total number of scenario loss estimates', table: schema.scenarioLossEstimates },
  // Assets
  { name: 'primary_assets_count', description: 'Total number of primary assets', table: schema.primaryAssets },
  { name: 'supporting_assets_count', description: 'Total number of supporting assets', table: schema.supportingAssets },
  { name: 'attack_surfaces_count', description: 'Total number of attack surfaces', table: schema.attackSurfaces },
  { name: 'support_to_primary_links_count', description: 'Total number of supporting-to-primary asset dependencies', table: schema.supportToPrimaryLinks },
  { name: 'support_to_support_links_count', description: 'Total number of supporting-to-supporting asset dependencies', table: schema.supportToSupportLinks },
  // Connectors: the source is a product dimension, not customer data
  { name: 'integration_settings_count', description: 'Total number of configured connector integrations', table: schema.integrationSettings },
  ...INTEGRATION_SOURCES.map((source) => ({
    name: `integration_${source}_count`,
    description: `Number of configured ${source} integrations`,
    table: schema.integrationSettings,
    filter: eq(schema.integrationSettings.source, source),
  })),
];

const snapshot = new Map<string, number>();

export const getSnapshotValue = (name: string): number => snapshot.get(name) ?? 0;

/**
 * Refresh all computed counts. Each count is individually guarded: a failed
 * read keeps the previous snapshot value instead of zeroing the gauge or
 * aborting the whole refresh (the XTM One contract).
 */
export const refreshSnapshot = async (
  db: DrizzleDB,
  onError?: (error: unknown, gaugeName: string) => void,
): Promise<void> => {
  for (const { name, table, filter } of COUNT_GAUGES) {
    try {
      const query = db.select({ value: count() }).from(table);
      const [row] = filter ? await query.where(filter) : await query;
      snapshot.set(name, row?.value ?? 0);
    } catch (error) {
      onError?.(error, name);
    }
  }
};
