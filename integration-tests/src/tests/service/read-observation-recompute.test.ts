import type { EventOrigin, ScenarioPricingPassOptions } from '@app/module';
import {
  allServiceDefinitions,
  AttackOutcome_DataBreachResale,
  BusinessValueCategory_PersonalData,
  createServices,
  crqIndicatorRuns,
  deriveSeedId,
  schema,
  StatementRecorder,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { FULLY_ANSWERED_PROFILE_ANSWERS } from '../../helpers/financial-profile-answers';
import { OBSERVED_JOB_FIXTURES } from '../../helpers/observed-job-fixtures';
import { db, pool } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const explainOnPool = async (sqlText: string, params: Array<unknown>): Promise<unknown> => {
  const result = await pool.query(sqlText, params);
  return result.rows;
};

/** What the job runtime hands an observed run: a Drizzle instance over the pool with a recorder
 * logger, whose EXPLAINs go to the same pool beside the run's own connection. */
const observedRun = () => {
  const recorder = new StatementRecorder(explainOnPool);
  return { recorder, db: drizzle(pool, { schema, logger: recorder }) };
};

describe('statement observation of the finding-score recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const createFindings = () => OBSERVED_JOB_FIXTURES['finding-score-recompute']({ services, db, tenantId, adminOrigin });

  it('should record exactly the tables a real recompute run reads and writes', async () => {
    await createFindings();

    const run = observedRun();
    const observed = createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'finding-score-recompute', interactive: false });
    const { scored } = await observed.findingScore.recomputeFindingScores();
    expect(scored).toBe(1);

    const { reads, writes, unattributed } = await run.recorder.resolve();
    expect(unattributed).toEqual([]);

    // The pinned observation of the first registrant. A diff here means the recompute's statements
    // changed, or the observation sprang a leak; both deserve a human look.
    expect(reads).toEqual([
      'asset_evidence',
      'asset_posture_history',
      'asset_postures',
      'asset_technique_scores',
      'attack_surface_mitre_techniques',
      'attack_surfaces',
      'control_capability_assessments',
      'control_capability_edges',
      'control_capability_protected_families',
      'control_capability_technique_overrides',
      'crq_indicator_settings',
      'cve',
      'cve_technique_mapping',
      'cve_technique_resolution',
      'cwe_technique_links',
      'cwe_technique_overrides',
      'cwe_weaknesses',
      'entry_openings',
      'finding_score_history',
      'finding_scores',
      'mitre_techniques',
      'organization_assets',
      'organizations',
      'supporting_assets',
      'threat_analyses',
      'threat_analysis_cves',
      'threat_relevance_settings',
      'unique_finding_score_history',
      'unique_finding_scores',
    ]);
    // `asset_technique_scores` and `entry_openings` are written only when a cell or a row is held or stale, which these findings never make.
    expect(writes).toEqual([
      'asset_posture_history',
      'asset_postures',
      'finding_metric_daily',
      'finding_score_history',
      'finding_scores',
      'unique_finding_score_history',
      'unique_finding_scores',
    ]);

    // The activity of an actor reaches the score as columns on `threat_analyses` now, so the
    // location and sector claims only enter the set through the admission's targeting predicates,
    // which an organization stating no country and no sector never runs. The subscription is per
    // tenant, so one that declares either still reads them and is woken by them.
    expect(reads).not.toContain('threat_analysis_locations');
    expect(reads).not.toContain('threat_analysis_sectors');

    // The day's row is a certified overwrite: nothing of the stored row reaches the figure, so a
    // write of this table by any origin leaves the recompute asleep.
    expect(reads).not.toContain('finding_metric_daily');

    // `users` is global and user-editable, so reading it would wake a full-estate recompute of
    // every tenant on a password or locale change; the membership predicate of its secured view
    // drags `tenant_users` in with it. Neither feeds the projected row.
    expect(reads).not.toContain('users');
    expect(reads).not.toContain('tenant_users');
    // Every connector sync bumps `last_reported_at`, and the connector name the row carries is a
    // label of the list rather than an input of the score.
    expect(reads).not.toContain('integration_settings');
  });

  it('should still subscribe an empty tenant to the table its first finding will land in', async () => {
    const run = observedRun();
    const { scored } = await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'finding-score-recompute', interactive: false })
      .findingScore.recomputeFindingScores();
    expect(scored).toBe(0);

    const { reads, unattributed } = await run.recorder.resolve();
    expect(unattributed).toEqual([]);
    // A tenant with nothing to score still has to be woken by the first evidence row, so the set
    // has to name that table even though no row of it was returned.
    expect(reads).toContain('asset_evidence');
  });

  it('should tag the recompute writes with the job kind through the writer', async () => {
    await createFindings();
    const listener = await pool.connect();
    const origins: Array<string | null> = [];
    try {
      listener.on('notification', (msg) => {
        const payload: unknown = JSON.parse(msg.payload ?? '{}');
        if (typeof payload === 'object' && payload !== null && 'table' in payload && payload.table === 'finding_scores') {
          origins.push('origin' in payload && typeof payload.origin === 'string' ? payload.origin : null);
        }
      });
      await listener.query('LISTEN data_changed');
      const run = observedRun();
      await createServices([...allServiceDefinitions], run.db)
        .withOrigin({ type: 'job', tenantId, jobKind: 'finding-score-recompute', interactive: false })
        .findingScore.recomputeFindingScores();
      const deadline = Date.now() + 3_000;
      while (origins.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      listener.release();
    }
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((origin) => origin === 'finding-score-recompute')).toBe(true);
  });

  it('should attribute a raw statement through EXPLAIN and widen when EXPLAIN is defeated', async () => {
    const run = observedRun();
    await run.db.execute(sql`select count(*) from users`);
    const first = await run.recorder.resolve();
    expect(first.unattributed).toEqual([]);
    expect(first.reads).toEqual(['users']);

    const failing = observedRun();
    await failing.db.execute(sql`do $$ begin end $$`);
    const second = await failing.recorder.resolve();
    expect(second.reads).toBeNull();
    expect(second.unattributed).toHaveLength(1);
  });
});

describe('statement observation of the intrusion-set activity recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const runRecompute = async (params: { isDailyBooking: boolean }) => {
    const run = observedRun();
    await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: false })
      .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: params.isDailyBooking });
    return run.recorder.resolve();
  };

  it('should record exactly the tables a real run reads and writes', async () => {
    await OBSERVED_JOB_FIXTURES['threat-activity-recompute']({ services, db, tenantId, adminOrigin });

    const { reads, writes, unattributed } = await runRecompute({ isDailyBooking: false });
    expect(unattributed).toEqual([]);
    expect(reads).toEqual([
      'threat_activity_anchors',
      'threat_analyses',
      'threat_analysis_attributions',
      'threat_analysis_cves',
      'threat_analysis_locations',
      'threat_analysis_sectors',
      'threat_analysis_techniques',
      'threat_relevance_settings',
    ]);
    expect(writes).toEqual(['threat_activity_anchors', 'threat_analyses']);
  });

  /**
   * The run replaces its own subscription, so a pass that rebuilt nothing has to issue the very
   * statements a pass that rebuilt everything does. Were it not so, one quiet day would drop the
   * claim tables from the set and no ingestion would ever wake the job again.
   */
  it('should read the same tables on a run that rebuilds nothing', async () => {
    await OBSERVED_JOB_FIXTURES['threat-activity-recompute']({ services, db, tenantId, adminOrigin });
    const first = await runRecompute({ isDailyBooking: false });

    const second = await runRecompute({ isDailyBooking: true });
    expect(second.unattributed).toEqual([]);
    expect(second.reads).toEqual(first.reads);
  });

  it('should still subscribe an empty tenant to the tables its first actor will land in', async () => {
    const { reads, unattributed } = await runRecompute({ isDailyBooking: false });
    expect(unattributed).toEqual([]);
    expect(reads).toContain('threat_analysis_techniques');
    expect(reads).toContain('threat_activity_anchors');
  });
});

describe('statement observation of the intrusion-set list projection recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const runRecompute = async () => {
    const run = observedRun();
    await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'threat-list-projection-recompute', interactive: false })
      .threatAnalyses.recomputeListProjections();
    return run.recorder.resolve();
  };

  it('should record exactly the tables a real run reads and writes', async () => {
    await OBSERVED_JOB_FIXTURES['threat-list-projection-recompute']({ services, db, tenantId, adminOrigin });

    const { reads, writes, unattributed } = await runRecompute();
    expect(unattributed).toEqual([]);
    expect(reads).toEqual([
      'attack_outcomes',
      'mitre_techniques',
      'threat_analyses',
      'threat_analysis_counts',
      'threat_analysis_cves',
      'threat_analysis_outcome_probabilities',
      'threat_analysis_techniques',
      'threat_outcome_scores',
      'threat_relevance_settings',
    ]);
    // Both projection tables are read as well as written, and both only by this job:
    // `findStaleAnalysisIdBatch` reads the stamped fingerprints off the counts row and
    // `deleteOutcomeScoresOutsideBatch` reads which stored score rows fall outside the batch. The
    // dispatcher drops an event whose origin is the job's own kind, so neither read makes the sweep
    // wake itself on what it just wrote.
    expect(writes).toEqual(['threat_analysis_counts', 'threat_outcome_scores']);
  });

  /**
   * A quiet run must issue the same statements a run that projects something does, or the
   * subscription would drop the claim tables from observation the moment a sweep finds nothing
   * stale and never pick a later ingestion back up.
   */
  it('should still subscribe an empty tenant to the tables its first analysis will land in', async () => {
    const { reads, unattributed } = await runRecompute();
    expect(unattributed).toEqual([]);
    expect(reads).toContain('threat_analysis_cves');
    expect(reads).toContain('threat_analysis_techniques');
  });

  /**
   * The scoping this job does on its own fingerprints is what makes this test load-bearing rather
   * than a repeat of the one above: a second run finds nothing stale and writes nothing, and the
   * statements it still issues on an empty batch are the whole of its subscription.
   */
  it('should read the same tables on a run that projects nothing', async () => {
    await OBSERVED_JOB_FIXTURES['threat-list-projection-recompute']({ services, db, tenantId, adminOrigin });
    const first = await runRecompute();

    const second = await runRecompute();
    expect(second.unattributed).toEqual([]);
    expect(second.reads).toEqual(first.reads);
  });
});

describe('statement observation of the asset criticality lift recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const runRecompute = async () => {
    const run = observedRun();
    const result = await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'asset-criticality-lift-recompute', interactive: false })
      .supportingAssets.recomputeCriticalityLifts();
    return { result, ...(await run.recorder.resolve()) };
  };

  it('should record exactly the tables a real run reads and writes', async () => {
    await OBSERVED_JOB_FIXTURES['asset-criticality-lift-recompute']({ services, db, tenantId, adminOrigin });

    const { result, reads, writes, unattributed } = await runRecompute();
    expect(result).toEqual({ lifted: 1, changed: 1 });
    expect(unattributed).toEqual([]);
    expect(reads).toEqual([
      'integration_settings',
      'supporting_asset_ai_target_properties',
      'supporting_asset_criticality_lifts',
      'supporting_asset_identity_properties',
      'supporting_asset_machine_properties',
      'supporting_asset_manual_values',
      'supporting_asset_relations',
      'supporting_asset_sources',
      'supporting_assets',
      'tenant_users',
      'users',
    ]);
    // No finding-score table among the reads: that job reads `supporting_assets`, which this one
    // writes, and a read of its output here would close a loop between the two.
    expect(writes).toEqual(['supporting_asset_criticality_lifts', 'supporting_assets']);
  });

  /**
   * A run with nothing to change reprojects nothing, so the tables only a reprojection reads drop
   * out; what it keeps is what makes a lift stale: the relations, the identities' bands and the
   * stored lifts.
   */
  it('should keep reading what makes a lift stale on a run that changes nothing', async () => {
    await OBSERVED_JOB_FIXTURES['asset-criticality-lift-recompute']({ services, db, tenantId, adminOrigin });
    await runRecompute();

    const { result, reads, writes, unattributed } = await runRecompute();
    expect(result).toEqual({ lifted: 1, changed: 0 });
    expect(unattributed).toEqual([]);
    expect(reads).toEqual(['supporting_asset_criticality_lifts', 'supporting_asset_relations', 'supporting_assets']);
    expect(writes).toEqual([]);
  });
});

describe('statement observation of the primary asset reach recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const runRecompute = async () => {
    const run = observedRun();
    const result = await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'primary-asset-reach-recompute', interactive: false })
      .assetDependencies.recomputePrimaryAssetReach();
    return { result, ...(await run.recorder.resolve()) };
  };

  it('should record exactly the tables a real run reads and writes', async () => {
    await OBSERVED_JOB_FIXTURES['primary-asset-reach-recompute']({ services, db, tenantId, adminOrigin });

    const { result, reads, writes, unattributed } = await runRecompute();
    expect(result).toEqual({ primaryAssets: 1, rows: 2, upserted: 2, deleted: 0 });
    expect(unattributed).toEqual([]);
    expect(reads).toEqual([
      'primary_asset_reach',
      'primary_assets',
      'support_to_primary_links',
      'support_to_support_links',
    ]);
    // An asset edit during a connector sync must not wake it.
    expect(reads).not.toContain('supporting_assets');
    expect(reads).not.toContain('organizations');
    expect(writes).toEqual(['primary_asset_reach']);
  });

  it('should read the same tables and write nothing on a run that changes nothing', async () => {
    await OBSERVED_JOB_FIXTURES['primary-asset-reach-recompute']({ services, db, tenantId, adminOrigin });
    const first = await runRecompute();

    const second = await runRecompute();
    expect(second.result).toEqual({ primaryAssets: 1, rows: 2, upserted: 0, deleted: 0 });
    expect(second.unattributed).toEqual([]);
    expect(second.reads).toEqual(first.reads);
    expect(second.writes).toEqual([]);
  });

  it('should still subscribe a tenant with no primary asset to the table its first one will land in', async () => {
    const { result, reads, unattributed } = await runRecompute();
    expect(result).toEqual({ primaryAssets: 0, rows: 0, upserted: 0, deleted: 0 });
    expect(unattributed).toEqual([]);
    expect(reads).toEqual(['primary_assets']);
  });
});

describe('statement observation of the attack outcome mixture recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const runRecompute = async () => {
    const run = observedRun();
    const result = await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'attack-outcome-mixture-recompute', interactive: false })
      .attackOutcomes.recomputeAttackOutcomeMixtures();
    return { result, ...(await run.recorder.resolve()) };
  };

  it('should record exactly the tables a real run reads and writes', async () => {
    await OBSERVED_JOB_FIXTURES['attack-outcome-mixture-recompute']({ services, db, tenantId, adminOrigin });

    const { result, reads, writes, unattributed } = await runRecompute();
    expect(result).toEqual({ written: 1, removed: 0, unchanged: 0 });
    expect(unattributed).toEqual([]);
    expect(reads).toEqual([
      'attack_outcome_mixture_groups',
      'attack_outcome_mixtures',
      'mitre_techniques',
      'organizations',
      'risk_scenarios',
      'threat_analyses',
      'threat_analysis_aliases',
      'threat_analysis_outcome_probabilities',
      'threat_analysis_techniques',
      'threat_relevance_settings',
    ]);
    expect(writes).toEqual(['attack_outcome_mixture_groups', 'attack_outcome_mixtures']);
  });

  /**
   * The run replaces its own subscription, so a run that writes nothing has to read what a run that
   * writes everything does, or one quiet day would unsubscribe it from the threat tables.
   */
  it('should read the same tables and write nothing on a run that changes nothing', async () => {
    await OBSERVED_JOB_FIXTURES['attack-outcome-mixture-recompute']({ services, db, tenantId, adminOrigin });
    const first = await runRecompute();

    const second = await runRecompute();
    expect(second.result).toEqual({ written: 0, removed: 0, unchanged: 1 });
    expect(second.unattributed).toEqual([]);
    expect(second.reads).toEqual(first.reads);
    expect(second.writes).toEqual([]);
  });

  it('should still subscribe a tenant with no scenario to the table its first one will land in', async () => {
    const { result, reads, unattributed } = await runRecompute();
    expect(result).toEqual({ written: 0, removed: 0, unchanged: 0 });
    expect(unattributed).toEqual([]);
    expect(reads).toContain('risk_scenarios');
    expect(reads).toContain('threat_relevance_settings');
  });
});

describe('statement observation of the OpenCTI mirror rebuild', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const runBatch = async () => {
    const run = observedRun();
    await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'opencti-mirror-rebuild', interactive: false })
      .openctiConnector.rebuildPendingBatch(tenantId, 200);
    return run.recorder.resolve();
  };

  it('should subscribe to the mirror it folds, which is what wakes it', async () => {
    await OBSERVED_JOB_FIXTURES['opencti-mirror-rebuild']({ services, db, tenantId, adminOrigin });

    const { reads, writes, unattributed } = await runBatch();
    expect(unattributed).toEqual([]);
    expect(reads).toContain('opencti_stream_objects');
    expect(writes).toContain('opencti_stream_objects');
    expect(writes).toContain('threat_analyses');
    expect(writes).toContain('threat_analysis_techniques');
    // The connector's own settings are configuration the rebuild never consults, and every cursor
    // flush writes that row: subscribing to it would buy a rebuild per flush for nothing.
    expect(reads).not.toContain('opencti_connector_settings');
  });

  /**
   * The subscription is replaced by each run, so a run that folded nothing must still issue the scan
   * a busy one does. One quiet minute would otherwise unsubscribe the job from the mirror, and no
   * write would ever wake it again.
   */
  it('should still read the mirror on a run that finds nothing marked', async () => {
    await OBSERVED_JOB_FIXTURES['opencti-mirror-rebuild']({ services, db, tenantId, adminOrigin });
    await runBatch();

    const { reads, unattributed } = await runBatch();
    expect(unattributed).toEqual([]);
    expect(reads).toContain('opencti_stream_objects');
  });

  it('should subscribe a tenant with no connector at all the same way', async () => {
    const { reads, unattributed } = await runBatch();
    expect(unattributed).toEqual([]);
    expect(reads).toContain('opencti_stream_objects');
  });

  /**
   * A run that gives the tenant up to another runner still replaces its own subscription, so it has
   * to carry the mirror read: an observation naming no table at all is persisted as a subscription
   * to every one of them, and the job would be woken by the whole estate until its next clean run.
   */
  it('should still subscribe to the mirror on a run that loses the tenant lock', async () => {
    await OBSERVED_JOB_FIXTURES['opencti-mirror-rebuild']({ services, db, tenantId, adminOrigin });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_try_advisory_xact_lock(1566, hashtext($1))', [tenantId]);

      const { reads, unattributed } = await runBatch();

      expect(unattributed).toEqual([]);
      expect(reads).toEqual(['opencti_stream_objects']);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });
});

describe('statement observation of the financial-estimates recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  /** An organization with an answered profile and a scenario whose activation set is non-empty
   * (a loss scope reaching Personal Data, under the Data Breach outcome), so the sweep's own
   * activation-set query, kernel derivation and write path are all genuinely exercised. */
  const createActivatedScenario = async () => {
    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: organizationId, name: 'Observed Organization' },
    ]);

    const attackOutcomeId = deriveSeedId(tenantId, AttackOutcome_DataBreachResale);
    const riskScenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Observed scenario',
      description: null,
      attackOutcomeId,
      primaryAssetIds: [],
    });

    const personalDataId = deriveSeedId(tenantId, BusinessValueCategory_PersonalData);
    const primaryAssetId = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id: primaryAssetId,
      organizationId,
      name: 'Observed asset',
      description: null,
      ownerId: null,
      businessValueCategoryIds: [personalDataId],
    });
    await services.withOrigin(adminOrigin).riskScenarios.updateRiskScenario(riskScenarioId, {
      primaryAssetIds: [primaryAssetId],
    });
    await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { employeeCount: 150 });
    await services.withOrigin(adminOrigin).financialProfiles.saveFinancialProfile(organizationId, FULLY_ANSWERED_PROFILE_ANSWERS);
  };

  it('should record exactly the tables a real recompute run reads and writes', async () => {
    await createActivatedScenario();

    const run = observedRun();
    const observed = createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'financial-estimates-recompute', interactive: false });
    const { recomputedScenarios, failedScenarios } = await observed.scenarioLossEstimates.recomputeQuestionnaireEstimates();
    expect(recomputedScenarios).toBe(1);
    expect(failedScenarios).toBe(0);

    const { reads, writes, unattributed } = await run.recorder.resolve();
    expect(unattributed).toEqual([]);

    // The pinned observation of the sweep. A diff here means the recompute's statements changed,
    // or the observation sprang a leak; both deserve a human look.
    expect(reads).toEqual([
      'declared_estate',
      'declared_estate_events',
      'financial_profiles',
      'organizations',
      'risk_scenario_business_value_categories',
      'risk_scenarios',
      'scenario_loss_estimates',
    ]);
    // The asset tables are deliberately absent: a scenario's loss scope is its own, so retagging an
    // asset changes nothing the kernel would price and must not wake the sweep. Changing which
    // assets a scenario names rewrites the scope itself, which does.
    expect(reads).not.toContain('primary_asset_business_value_categories');
    expect(reads).not.toContain('risk_scenario_primary_assets');
    // `risk_scenarios` is written as well as read: each scenario stamps the answers version it now
    // covers. That is a table this job subscribes to, so the stamp is guarded to write only on a
    // real change — the run after an answer change wakes one successor, which finds every stamp
    // current, writes nothing and settles.
    expect(writes).toEqual(['financial_profiles', 'risk_scenarios', 'scenario_loss_estimates']);
  });

  it('should still subscribe an organization with no scenario yet to the tables its first one will touch', async () => {
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: uuidv7(), name: 'Profile-only organization' },
    ]);

    const run = observedRun();
    const { recomputedScenarios } = await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'financial-estimates-recompute', interactive: false })
      .scenarioLossEstimates.recomputeQuestionnaireEstimates();
    expect(recomputedScenarios).toBe(0);

    const { reads, unattributed } = await run.recorder.resolve();
    expect(unattributed).toEqual([]);
    // A tenant with no organization/profile/scenario yet still has to be woken by the first one,
    // so the set has to name these tables even though no row of them fed a derivation.
    expect(reads).toContain('organizations');
    expect(reads).toContain('financial_profiles');
  });
});

describe('statement observation of the CRQ price recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const runPass = async (options: ScenarioPricingPassOptions = {}) => {
    const run = observedRun();
    const pass = await createServices([...allServiceDefinitions], run.db)
      .withOrigin({ type: 'job', tenantId, jobKind: 'crq-price-recompute', interactive: false })
      .crqIndicators.priceAllScenarios(tenantId, undefined, undefined, options);
    return { pass, ...(await run.recorder.resolve()) };
  };

  it('should record exactly the tables a real pass reads and writes', async () => {
    await OBSERVED_JOB_FIXTURES['crq-price-recompute']({ services, db, tenantId, adminOrigin });

    const { pass, reads, writes, unattributed } = await runPass();
    expect(pass).toEqual({ priced: 2, unchanged: 0, skipped: 0, refused: [], resumeAfter: null });
    expect(unattributed).toEqual([]);

    // The pinned observation of the price pass. A diff here means the pricing's statements changed,
    // or the observation sprang a leak; both deserve a human look.
    expect(reads).toEqual([
      'asset_evidence',
      'attack_outcome_mitre_techniques',
      'attack_outcome_mixture_groups',
      'attack_outcome_mixtures',
      'attack_outcomes',
      'attack_surface_mitre_techniques',
      'attack_surfaces',
      'control_capabilities',
      'control_capability_assessments',
      'control_capability_edges',
      'control_capability_scope_overrides',
      'control_capability_technique_overrides',
      'control_technique_test_results',
      'countries',
      // The writer's own policy check on the run its rows hang off. The pass's own writes are its
      // echo, so only a full run's wakes it, once.
      'crq_indicator_runs',
      'crq_indicator_settings',
      'crq_indicator_tef_inputs',
      'declared_estate',
      'entry_openings',
      'loss_categories',
      'loss_drivers',
      'mitre_technique_tactics',
      'mitre_techniques',
      'organization_assets',
      'organizations',
      'risk_scenario_primary_assets',
      'risk_scenarios',
      'scenario_loss_estimates',
      'sectors',
      'support_to_primary_links',
      'supporting_asset_identity_properties',
      'supporting_asset_relations',
      'supporting_asset_sources',
      'supporting_assets',
      'tef_estimates',
      'threat_analyses',
      'threat_analysis_cves',
      'threat_analysis_techniques',
    ]);
    // The automatic TEF is written once, by the first pass over a scenario that has none.
    expect(writes).toEqual([
      'crq_indicator_group_scores',
      'crq_indicator_run_annual_losses',
      'crq_indicator_run_reach_gaps',
      'crq_indicator_runs',
      'tef_estimates',
    ]);
    // `users` is global: reading it would reprice every tenant on any account edit.
    expect(reads).not.toContain('users');
    expect(reads).not.toContain('tenant_users');
    // A plan never moves the ALE, and the price profile prices none.
    expect(reads).not.toContain('treatment_plans');
  });

  it('should stop past its budget and resume where it stopped, pricing every scenario once', async () => {
    await OBSERVED_JOB_FIXTURES['crq-price-recompute']({ services, db, tenantId, adminOrigin });
    const [first, second] = await services.withOrigin(adminOrigin).riskScenarios.getAllRiskScenarioIds();

    const { pass: head } = await runPass({ budgetMs: 0 });
    expect(head).toEqual({ priced: 1, unchanged: 0, skipped: 0, refused: [], resumeAfter: first });

    const { pass: tail } = await runPass({ budgetMs: 0, after: first });
    expect(tail).toEqual({ priced: 1, unchanged: 0, skipped: 0, refused: [], resumeAfter: null });

    const runs = await db.select({ riskScenarioId: crqIndicatorRuns.riskScenarioId }).from(crqIndicatorRuns);
    expect(runs.map((run) => run.riskScenarioId).sort()).toEqual([first, second].sort());
  });

  it('should keep reading every input of a scenario it writes no run for, and write nothing', async () => {
    await OBSERVED_JOB_FIXTURES['crq-price-recompute']({ services, db, tenantId, adminOrigin });
    const first = await runPass();

    const second = await runPass();

    expect(second.pass).toEqual({ priced: 0, unchanged: 2, skipped: 0, refused: [], resumeAfter: null });
    expect(second.reads).toEqual(first.reads);
    expect(second.writes).toEqual([]);
  });

  it('should tag its runs and its automatic TEF with the job kind through the writer', async () => {
    await OBSERVED_JOB_FIXTURES['crq-price-recompute']({ services, db, tenantId, adminOrigin });
    const watched = new Set(['crq_indicator_runs', 'tef_estimates']);
    const listener = await pool.connect();
    const origins = new Map<string, Array<string | null>>();
    try {
      listener.on('notification', (msg) => {
        const payload: unknown = JSON.parse(msg.payload ?? '{}');
        if (typeof payload === 'object' && payload !== null && 'table' in payload && typeof payload.table === 'string' && watched.has(payload.table)) {
          origins.set(payload.table, [
            ...(origins.get(payload.table) ?? []),
            'origin' in payload && typeof payload.origin === 'string' ? payload.origin : null,
          ]);
        }
      });
      await listener.query('LISTEN data_changed');
      await runPass();
      const deadline = Date.now() + 3_000;
      while (origins.size < watched.size && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      listener.release();
    }
    expect([...origins.keys()].sort()).toEqual([...watched].sort());
    expect([...origins.values()].flat().every((origin) => origin === 'crq-price-recompute')).toBe(true);
  });

  it('should still subscribe a tenant with no scenario to the table its first one will land in', async () => {
    const { pass, reads, unattributed } = await runPass();
    expect(pass).toEqual({ priced: 0, unchanged: 0, skipped: 0, refused: [], resumeAfter: null });
    expect(unattributed).toEqual([]);
    expect(reads).toContain('risk_scenarios');
  });
});
