// First, so every schema's defineSecurityPolicies runs once the modules <-> security/policies cycle
// has settled: through ../modules/schema alone, the policies register as undefined.
import '../index';
import { is } from 'drizzle-orm';
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../modules/schema';
import { getSecurityPolicies } from './policy';

const SHARED_CATALOGUE = 'Reference data every tenant reads alike.';
const PLATFORM_RUNTIME = 'Platform runtime state, outside any tenant.';

/** The tables no policy guards. `views.*` reads them whole, so none may hold a tenant's rows unless every read joins it to a secured table. */
const UNGUARDED_TABLES: Record<string, string> = {
  capabilities: SHARED_CATALOGUE,
  compliance_framework_nodes: SHARED_CATALOGUE,
  compliance_frameworks: SHARED_CATALOGUE,
  compliance_requirement_controls: SHARED_CATALOGUE,
  control_capabilities: SHARED_CATALOGUE,
  control_capability_crosswalk: SHARED_CATALOGUE,
  control_capability_edges: SHARED_CATALOGUE,
  control_capability_protected_families: SHARED_CATALOGUE,
  control_capability_strength_rung_labels: SHARED_CATALOGUE,
  cwe_technique_links: SHARED_CATALOGUE,
  cwe_weaknesses: SHARED_CATALOGUE,
  drata_requirement_controls: 'Written through rawDb() once views.drataRequirements has proved the requirement, and only read joined to the secured requirements and controls.',
  mitre_mitigation_techniques: SHARED_CATALOGUE,
  mitre_mitigations: SHARED_CATALOGUE,
  mitre_tactics: SHARED_CATALOGUE,
  mitre_technique_tactics: SHARED_CATALOGUE,
  mitre_techniques: SHARED_CATALOGUE,
  platform_capabilities: SHARED_CATALOGUE,
  platform_metadata: PLATFORM_RUNTIME,
  security_platform_families: SHARED_CATALOGUE,
  security_platform_family_controls: SHARED_CATALOGUE,
  sessions: PLATFORM_RUNTIME,
  workers: PLATFORM_RUNTIME,
};

const READ_THROUGH_VIEWS = 'Written from rows the writer read through views.* under its own tenant.';
const RECOMPUTED = 'Computed by the tenant\'s own job from rows it read through views.*.';
const CONNECTOR_OF_THE_SYNC = 'Only the syncs write it, with integrationSettings.getConnectorId, which reads the tenant\'s own connector.';
const CONNECTOR_CHECKED = 'Checked through views.integrationSettings before the write.';
const SERVICE_ACCOUNT_OF_THE_ORIGIN = 'Taken from the origin, whose service account the policy proves to belong to the origin\'s tenant.';
const BESIDE_OWN_SOURCE = 'Written beside the tenant\'s own source row, created or read through views.*.';

/**
 * Foreign keys from a table that carries a `tenant_id` to a tenant's data, keyed on the id alone. Such
 * a key only proves the referenced row exists: the database stores a row of one tenant naming another
 * tenant's row, which hides it from its own tenant and blocks the other's deletion. Each
 * one stays only with the reason no write can put another tenant's id in it.
 */
const PLAIN_TENANT_REFERENCES: Record<string, string> = {
  'asset_enumerations.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'asset_enumerations.supporting_asset_id -> supporting_assets': READ_THROUGH_VIEWS,
  'asset_evidence.supporting_asset_id -> supporting_assets': 'Checked through views.supportingAssets before a finding is attached by hand; the syncs resolve it from the tenant\'s own sources.',
  'asset_evidence_sources.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'asset_evidence_verdicts.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'asset_group_members.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'asset_groups.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'asset_posture_history.supporting_asset_id -> supporting_assets': RECOMPUTED,
  'asset_posture_history.worst_asset_evidence_id -> asset_evidence': RECOMPUTED,
  'asset_postures.supporting_asset_id -> supporting_assets': RECOMPUTED,
  'asset_technique_scores.asset_evidence_id -> asset_evidence': RECOMPUTED,
  'asset_technique_scores.supporting_asset_id -> supporting_assets': RECOMPUTED,
  'compliance_assessments.created_by_service_account_id -> service_accounts': SERVICE_ACCOUNT_OF_THE_ORIGIN,
  'compliance_assessments.published_by_service_account_id -> service_accounts': SERVICE_ACCOUNT_OF_THE_ORIGIN,
  'control_capability_assessment_events.organization_id -> organizations': 'Checked through views.organizations in the transaction that writes it.',
  'control_proven_posture_history.organization_id -> organizations': RECOMPUTED,
  'cve_affected_versions.cve_id -> cve': READ_THROUGH_VIEWS,
  'cve_references.cve_id -> cve': READ_THROUGH_VIEWS,
  'cve_source_observations.cve_id -> cve': READ_THROUGH_VIEWS,
  'cve_technique_mapping.cve_id -> cve': READ_THROUGH_VIEWS,
  'cve_technique_mapping.resolution_id -> cve_technique_resolution': 'Minted with the resolution row it names, in the same tenant.',
  'cve_technique_resolution.cve_id -> cve': READ_THROUGH_VIEWS,
  'drata_requirements.framework_id -> drata_frameworks': READ_THROUGH_VIEWS,
  'entry_openings.asset_evidence_id -> asset_evidence': RECOMPUTED,
  'entry_openings.cve_id -> cve': RECOMPUTED,
  'entry_openings.supporting_asset_id -> supporting_assets': RECOMPUTED,
  'financial_profiles.organization_id -> organizations': 'The table\'s organizationTenantIsolationPolicy proves the scope\'s tenant on every insert.',
  'finding_score_history.asset_evidence_id -> asset_evidence': RECOMPUTED,
  'finding_scores.asset_evidence_id -> asset_evidence': RECOMPUTED,
  'integration_settings.service_account_id -> service_accounts': 'Checked through views.serviceAccounts by the integrations router before the write.',
  'job_logs.job_id -> jobs': 'Taken with tenant_id from the same job row.',
  'job_step_counts.job_id -> jobs': 'Taken with tenant_id from the same job row.',
  'loss_drivers.loss_category_id -> loss_categories': 'Derived from the row\'s own tenant id, and written by no product path.',
  'openaev_assets.connector_id -> integration_settings': CONNECTOR_CHECKED,
  'openaev_attack_observations.connector_id -> integration_settings': CONNECTOR_CHECKED,
  'openaev_scan_measurements.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'openaev_sync_streams.connector_id -> integration_settings': CONNECTOR_CHECKED,
  'opencti_connector_settings.service_account_id -> service_accounts': 'Checked through views.serviceAccounts by the OpenCTI router before the write.',
  'service_account_tokens.service_account_id -> service_accounts': 'Checked through views.serviceAccounts against the origin\'s tenant before a token is issued.',
  'stored_files.created_by_service_account_id -> service_accounts': SERVICE_ACCOUNT_OF_THE_ORIGIN,
  'supporting_asset_ai_target_properties.supporting_asset_source_id -> supporting_asset_sources': BESIDE_OWN_SOURCE,
  'supporting_asset_criticality_lifts.from_asset_id -> supporting_assets': 'Copied from a relation whose composite key already holds it to the tenant.',
  'supporting_asset_identity_properties.supporting_asset_source_id -> supporting_asset_sources': BESIDE_OWN_SOURCE,
  'supporting_asset_machine_properties.supporting_asset_source_id -> supporting_asset_sources': BESIDE_OWN_SOURCE,
  'supporting_asset_relations.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'supporting_asset_sources.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'supporting_asset_sources.supporting_asset_id -> supporting_assets': 'Checked through views.supportingAssets on an edit, the asset just created on a creation, resolved through views.* by the syncs.',
  'supporting_asset_tags.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'tag_sources.connector_id -> integration_settings': CONNECTOR_OF_THE_SYNC,
  'tag_sources.tag_id -> tags': 'Read through views.tags, or created in the same tenant.',
  'tags.merged_into_tag_id -> tags': 'Checked through views.tags before a merge.',
  'threat_activity_anchors.analysis_id -> threat_analyses': RECOMPUTED,
  'threat_analysis_counts.analysis_id -> threat_analyses': RECOMPUTED,
  'threat_outcome_scores.analysis_id -> threat_analyses': RECOMPUTED,
  'threat_outcome_scores.attack_outcome_id -> attack_outcomes': 'Copied from threat_analysis_outcome_probabilities.attack_outcome_id, which its composite key holds to the tenant.',
  'unique_finding_score_history.cve_id -> cve': 'Copied from asset_evidence.cve_id, which its composite key holds to the tenant.',
  'unique_finding_score_history.organization_id -> organizations': RECOMPUTED,
  'unique_finding_scores.cve_id -> cve': 'Copied from asset_evidence.cve_id, which its composite key holds to the tenant.',
  'unique_finding_scores.organization_id -> organizations': RECOMPUTED,
};

/**
 * Tables that reach their tenant only through a parent, so their policy joins the parent on every
 * read and their other foreign keys are proved by the services alone. A new table carries its own
 * `tenant_id` and composite foreign keys instead.
 */
const PARENT_SCOPED_TABLES = [
  'attack_outcome_mitre_techniques', 'attack_surface_mitre_techniques',
  'budget_review_closed_figures', 'budget_review_closed_postures', 'budget_review_closed_tolerances', 'budget_review_line_controls',
  'budget_review_lines', 'budget_reviews', 'control_capability_scope_overrides', 'crq_budget_review_annual_losses',
  'crq_budget_review_results', 'crq_control_what_if_results', 'crq_cve_what_if_results', 'crq_indicator_group_scores',
  'crq_indicator_run_annual_losses', 'crq_indicator_run_reach_gaps', 'crq_indicator_run_unplayable_obstacles', 'crq_indicator_runs',
  'crq_indicator_tef_inputs', 'crq_plan_what_if_results', 'crq_technique_what_if_results', 'drata_requirement_controls',
  'group_roles', 'group_users', 'job_errors',
  'loss_driver_activations', 'organization_risk_tolerances', 'primary_asset_business_value_categories',
  'risk_scenario_business_value_categories', 'risk_scenario_primary_assets', 'risk_scenario_risk_tolerances',
  'role_capabilities', 'scenario_loss_estimates', 'service_account_groups',
  'supporting_asset_manual_values',
  'tef_estimates', 'threat_analysis_aliases', 'threat_analysis_attributions', 'threat_analysis_cves',
  'threat_analysis_goals', 'threat_analysis_locations', 'threat_analysis_roles',
  'threat_analysis_secondary_motives', 'threat_analysis_sectors', 'threat_analysis_techniques', 'threat_analysis_threat_actor_types',
  'treatment_plan_moves', 'treatment_plans',
];

type Table = PgTableWithColumns<TableConfig>;

const tables = Object.values<unknown>(schema).filter((value): value is Table => is(value, PgTable));
const nameOf = (table: PgTable) => getTableConfig(table).name;
const ownsTenant = (table: PgTable) => getTableConfig(table).columns.some((column) => column.name === 'tenant_id');
const referencesOf = (table: PgTable) => getTableConfig(table).foreignKeys.map((foreignKey) => foreignKey.reference());
const policiesOf = (table: Table) => getSecurityPolicies(table).filter((policy) => policy !== undefined);

/** A table holds a tenant's rows through its own `tenant_id`, or a chain of foreign keys up to one. */
const tenantDataTables = (): Set<string> => {
  const found = new Set(tables.filter(ownsTenant).map(nameOf));
  let grown = true;
  while (grown) {
    grown = false;
    for (const table of tables) {
      const reachesTenant = referencesOf(table).some((reference) => found.has(nameOf(reference.foreignTable)) && nameOf(reference.foreignTable) !== 'tenants');
      if (!found.has(nameOf(table)) && reachesTenant) {
        found.add(nameOf(table));
        grown = true;
      }
    }
  }
  return found;
};

const sorted = (names: Iterable<string>) => [...names].sort();

describe('tenancy conventions', () => {
  it('should guard every table with a policy, but the ones that hold no tenant data', () => {
    const unguarded = tables.filter((table) => policiesOf(table).length === 0).map(nameOf);

    expect(
      sorted(unguarded),
      'A table without a security policy is read whole through views.*, every tenant\'s rows included. Give it a policy, or list it with the reason it holds no tenant\'s rows.',
    ).toEqual(sorted(Object.keys(UNGUARDED_TABLES)));
  });

  it('should filter the reads of every table that carries a tenant_id, without exception', () => {
    expect(tables.filter((table) => ownsTenant(table) && !policiesOf(table).some((policy) => policy.read)).map(nameOf)).toEqual([]);
  });

  it('should name the tenant on both sides of a foreign key between two tenants\' tables', () => {
    const tenantData = tenantDataTables();
    const plain = tables.filter(ownsTenant).flatMap((table) => referencesOf(table)
      .filter((reference) => tenantData.has(nameOf(reference.foreignTable)) && nameOf(reference.foreignTable) !== 'tenants')
      .filter((reference) => {
        const at = reference.columns.findIndex((column) => column.name === 'tenant_id');
        return at === -1 || reference.foreignColumns[at].name !== 'tenant_id';
      })
      .map((reference) => `${nameOf(table)}.${reference.columns.map((column) => column.name).join(',')} -> ${nameOf(reference.foreignTable)}`));

    expect(
      sorted(plain),
      'Declare the key on (column, tenant_id) against a UNIQUE (id, tenant_id) of the referenced table, as risk_scenarios does, so the database refuses another tenant\'s row.',
    ).toEqual(sorted(Object.keys(PLAIN_TENANT_REFERENCES)));
  });

  it('should list every table that reaches its tenant only through a parent', () => {
    const tenantData = tenantDataTables();
    const parentScoped = tables.filter((table) => !ownsTenant(table) && tenantData.has(nameOf(table))).map(nameOf);

    expect(
      sorted(parentScoped),
      'Give the table its own tenant_id and composite foreign keys to its parents, rather than reaching the tenant through them.',
    ).toEqual(sorted(PARENT_SCOPED_TABLES));
  });
});
