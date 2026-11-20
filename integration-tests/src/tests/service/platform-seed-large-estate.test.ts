import {
  assetEnumerations,
  assetEvidence,
  assetEvidenceHistory,
  assetEvidenceSources,
  cveTechniqueMapping,
  findingScores,
  largeEstateAssetId,
  Organization_AcmeRetailNetwork,
  organizationAssets,
  organizations,
  primaryAssets,
  riskScenarioBusinessValueCategories,
  riskScenarioPrimaryAssets,
  riskScenarios,
  runPlatformSeed,
  scenarioLossEstimates,
  supportingAssets,
  supportingAssetSources,
  supportToPrimaryLinks,
  supportToSupportLinks,
  UNEVALUATED_LET_THROUGH,
  users,
} from '@app/module';
import { and, eq, inArray, isNotNull, isNull, sql, TransactionRollbackError } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { rederiveFindingStates } from '../../helpers/finding-state-rederivation';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const TEST_ADMIN_EMAIL = 'admin@test.com';
const TEST_ADMIN_PASSWORD = 'TestPass123!';

/**
 * The sizes of the acceptance criteria are exercised by `scripts/perf/estate-bench.mjs` against a
 * running stack, never here.
 */
const LARGE_ESTATE = { assets: 400, findings: 1200, mappedAssets: 120 };

const SCOPE_NAME = 'Acme Retail Network';

/** The profile's own rows, by the id group of `largeEstateAssetId`: some of them carry no name to recognise them by. */
const GENERATED_ASSET_NAME = sql`${supportingAssets.id}::text like ${`${largeEstateAssetId(0).slice(0, 14)}%`}`;

const countOfGeneratedAssets = async (): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportingAssets)
    .where(GENERATED_ASSET_NAME);
  return row.count;
};

/** Findings per asset over a slice of the park, taken in asset-index order: a site is a run of it. */
const findingsPerAssetBetween = async (fromIndex: number, toIndex: number): Promise<number> => {
  const [row] = await db
    .select({
      mean: sql<number>`count(${assetEvidence.id})::float8 / count(distinct ${supportingAssets.id})`,
    })
    .from(supportingAssets)
    .leftJoin(assetEvidence, eq(assetEvidence.supportingAssetId, supportingAssets.id))
    .where(inArray(
      supportingAssets.id,
      Array.from({ length: toIndex - fromIndex }, (_, offset) => largeEstateAssetId(fromIndex + offset)),
    ));
  return row.mean;
};

const countOfGeneratedFindings = async (): Promise<number> => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetEvidence)
    .innerJoin(supportingAssets, eq(supportingAssets.id, assetEvidence.supportingAssetId))
    .where(GENERATED_ASSET_NAME);
  return row.count;
};

describe('Platform Seed - large estate profile', () => {
  beforeAll(async () => {
    await truncateAllTables(db);
    await runPlatformSeed(db, {
      adminEmail: TEST_ADMIN_EMAIL,
      adminPassword: TEST_ADMIN_PASSWORD,
      largeEstate: LARGE_ESTATE,
    });
  }, 240_000);

  it('should add the asked-for assets on top of the ordinary seed, with their dependency chains', async () => {
    expect(await countOfGeneratedAssets()).toBe(LARGE_ESTATE.assets);

    // Every generated asset but its site's root hangs under another one, so the park is chained and not flat.
    const [links] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportToSupportLinks);
    expect(links.count).toBeGreaterThan(LARGE_ESTATE.assets - 10);
  });

  it('should name its rows from the profile\'s stable ids', async () => {
    const [scope] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, SCOPE_NAME));
    expect(scope.id).toBe(Organization_AcmeRetailNetwork);

    const [first] = await db.select({ id: supportingAssets.id }).from(supportingAssets).where(eq(supportingAssets.id, largeEstateAssetId(0)));
    expect(first.id).toBe(largeEstateAssetId(0));
  });

  it('should hang the asked-for findings on CVEs that exist, each with a score to page over', async () => {
    expect(await countOfGeneratedFindings()).toBe(LARGE_ESTATE.findings);

    const [scored] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(findingScores)
      .innerJoin(assetEvidence, eq(assetEvidence.id, findingScores.assetEvidenceId))
      .innerJoin(supportingAssets, eq(supportingAssets.id, assetEvidence.supportingAssetId))
      .where(GENERATED_ASSET_NAME);
    expect(scored.count).toBe(LARGE_ESTATE.findings);

    const [orphans] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assetEvidence)
      .innerJoin(supportingAssets, eq(supportingAssets.id, assetEvidence.supportingAssetId))
      .where(sql`${GENERATED_ASSET_NAME} and not exists (select 1 from cve where cve.id = ${assetEvidence.cveId})`);
    expect(orphans.count).toBe(0);
  });

  it('should score them the way the engine would', async () => {
    // The engine names a technique only where one set what gets through, and lets everything
    // through where none stands, so a row naming none below the reference value is one it would never write.
    const [inconsistent] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(findingScores)
      .where(sql`${findingScores.weakestTechniqueId} is null and ${findingScores.exploitationLetThrough} <> ${UNEVALUATED_LET_THROUGH}`);
    expect(inconsistent.count).toBe(0);

    const [fractional] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(findingScores)
      .where(sql`${findingScores.score} <> trunc(${findingScores.score})`);
    expect(fractional.count).toBe(0);
  });

  it('should name as the weakest path only an exploitation claim of the finding\'s own CVE', async () => {
    const [named] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(findingScores)
      .where(isNotNull(findingScores.weakestTechniqueId));
    expect(named.count).toBeGreaterThan(0);

    // The seed runs the engine's recompute, whose topology rule answers the exploitation of a CVE that
    // names none of its own (`readAttackClaims`): a technique outside the stored claims is off side only
    // where the CVE names an exploitation claim, so the rule never answered for it.
    const [offSide] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(findingScores)
      .innerJoin(assetEvidence, eq(assetEvidence.id, findingScores.assetEvidenceId))
      .where(sql`${findingScores.weakestTechniqueId} is not null and not exists (
        select 1 from ${cveTechniqueMapping}
        where ${cveTechniqueMapping.cveId} = ${assetEvidence.cveId}
          and ${cveTechniqueMapping.mitreTechniqueId} = ${findingScores.weakestTechniqueId}
          and ${cveTechniqueMapping.role} = 'exploitation_technique'
          and ${cveTechniqueMapping.lane} <> 'structural')
        and exists (
        select 1 from ${cveTechniqueMapping}
        where ${cveTechniqueMapping.cveId} = ${assetEvidence.cveId}
          and ${cveTechniqueMapping.role} = 'exploitation_technique'
          and ${cveTechniqueMapping.lane} <> 'structural')`);
    expect(offSide.count).toBe(0);
  });

  it('should give every generated asset and finding a reporting connector', async () => {
    const [assetSources] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportingAssetSources)
      .innerJoin(supportingAssets, eq(supportingAssets.id, supportingAssetSources.supportingAssetId))
      .where(sql`${GENERATED_ASSET_NAME} and ${isNotNull(supportingAssetSources.connectorId)}`);
    expect(assetSources.count).toBe(LARGE_ESTATE.assets);

    const [findingSources] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assetEvidenceSources)
      .innerJoin(assetEvidence, eq(assetEvidence.id, assetEvidenceSources.assetEvidenceId))
      .innerJoin(supportingAssets, eq(supportingAssets.id, assetEvidence.supportingAssetId))
      .where(GENERATED_ASSET_NAME);
    expect(findingSources.count).toBe(LARGE_ESTATE.findings);
  });

  it('should map the asked-for assets into one closed scope, scattered across the park', async () => {
    const [scope] = await db.select().from(organizations).where(eq(organizations.name, SCOPE_NAME));
    expect(scope.estateMode).toBe('closed');
    expect(scope.estateChangedAt).not.toBeNull();

    const [mapped] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(organizationAssets)
      .where(eq(organizationAssets.organizationId, scope.id));
    expect(mapped.count).toBe(LARGE_ESTATE.mappedAssets);

    // A mapping that is a prefix of the park hands every reader a locality no connector would
    // produce, so the seeded one has to reach past the first `mappedAssets` assets.
    const prefix = new Set(Array.from({ length: LARGE_ESTATE.mappedAssets }, (_, index) => largeEstateAssetId(index)));
    const mappedIds = await db
      .select({ id: organizationAssets.supportingAssetId })
      .from(organizationAssets)
      .where(eq(organizationAssets.organizationId, scope.id));
    expect(mappedIds.some((row) => !prefix.has(row.id))).toBe(true);
  });

  it('should give the scope three primary assets carrying supporting assets', async () => {
    const assets = await db
      .select({ id: primaryAssets.id })
      .from(primaryAssets)
      .where(eq(primaryAssets.organizationId, Organization_AcmeRetailNetwork));
    expect(assets).toHaveLength(3);

    const links = await db
      .select({ primaryAssetId: supportToPrimaryLinks.primaryAssetId })
      .from(supportToPrimaryLinks)
      .where(inArray(supportToPrimaryLinks.primaryAssetId, assets.map((asset) => asset.id)));
    expect(new Set(links.map((link) => link.primaryAssetId)).size).toBe(3);
  });

  it('should give the scope six scenarios, three aiming at a primary asset and three direct', async () => {
    const scenarios = await db
      .select({ id: riskScenarios.id })
      .from(riskScenarios)
      .where(eq(riskScenarios.organizationId, Organization_AcmeRetailNetwork));
    expect(scenarios).toHaveLength(6);

    const aimed = await db
      .selectDistinct({ id: riskScenarioPrimaryAssets.riskScenarioId })
      .from(riskScenarioPrimaryAssets)
      .where(inArray(riskScenarioPrimaryAssets.riskScenarioId, scenarios.map((scenario) => scenario.id)));
    expect(aimed).toHaveLength(3);

    // Both shapes carry a loss scope: a scenario with none gives the engine nothing to price.
    const priced = await db
      .selectDistinct({ id: riskScenarioBusinessValueCategories.riskScenarioId })
      .from(riskScenarioBusinessValueCategories)
      .where(inArray(riskScenarioBusinessValueCategories.riskScenarioId, scenarios.map((scenario) => scenario.id)));
    expect(priced).toHaveLength(6);
  });

  it('should derive the scope\'s questionnaire estimates, leaving no recompute pending', async () => {
    // Left to the boot backfill, the derivation would book a simulation for every scenario of the scope.
    const [admin] = await db.select().from(users).where(eq(users.email, TEST_ADMIN_EMAIL));
    const [scope] = await db.select().from(organizations).where(eq(organizations.id, Organization_AcmeRetailNetwork));
    const acmeServices = createTestServices(db).withOrigin({ type: 'client', userId: admin.id, tenantId: scope.tenantId });
    const scenarios = await db
      .select({ id: riskScenarios.id })
      .from(riskScenarios)
      .where(eq(riskScenarios.organizationId, Organization_AcmeRetailNetwork));

    for (const scenario of scenarios) {
      const derived = await db
        .select({ id: scenarioLossEstimates.id })
        .from(scenarioLossEstimates)
        .where(and(eq(scenarioLossEstimates.riskScenarioId, scenario.id), eq(scenarioLossEstimates.provenance, 'questionnaire')));
      expect(derived.length).toBeGreaterThan(0);

      const summary = await acmeServices.scenarioLossEstimates.getFinancialSummary(scenario.id);
      expect(summary.recomputePending).toBe(false);
    }
  });

  it('should seed devices the connector reports with an address and no name, named by derivation', async () => {
    const nameless = await db
      .select({ derivedName: supportingAssets.derivedName, displayName: supportingAssets.displayName })
      .from(supportingAssets)
      .where(and(GENERATED_ASSET_NAME, isNull(supportingAssets.name)));
    expect(nameless.length).toBeGreaterThan(0);
    expect(nameless.every((asset) => asset.derivedName !== null && asset.displayName === asset.derivedName)).toBe(true);
    expect(nameless.some((asset) => /^[^·]+ · 10\./.test(asset.derivedName ?? ''))).toBe(true);
    expect(nameless.some((asset) => /^10\./.test(asset.derivedName ?? ''))).toBe(true);
  });

  it('should leave the ordinary seed alone', async () => {
    const [acme] = await db.select().from(organizations).where(eq(organizations.name, 'Acme Bank'));
    expect(acme.estateMode).toBe('open');
  });

  it('should write nothing a second time, since the seed stops on an admin that already exists', async () => {
    await runPlatformSeed(db, {
      adminEmail: TEST_ADMIN_EMAIL,
      adminPassword: TEST_ADMIN_PASSWORD,
      largeEstate: LARGE_ESTATE,
    });

    expect(await countOfGeneratedAssets()).toBe(LARGE_ESTATE.assets);
    expect(await countOfGeneratedFindings()).toBe(LARGE_ESTATE.findings);
  }, 120_000);

  it('should spread the sightings and never date a row before the row it hangs on', async () => {
    const [assets] = await db
      .select({
        sightings: sql<number>`count(distinct ${supportingAssets.lastSeenAt})::int`,
        seenBeforeFirstSeen: sql<number>`count(*) filter (where ${supportingAssets.lastSeenAt} < ${supportingAssets.firstSeenAt})::int`,
      })
      .from(supportingAssets)
      .where(GENERATED_ASSET_NAME);
    // A flat draw collapses the column onto one value for the whole park, which hands every
    // reader that sorts or windows on recency a selectivity no tenant has.
    expect(assets.sightings).toBeGreaterThan(LARGE_ESTATE.assets / 4);
    expect(assets.seenBeforeFirstSeen).toBe(0);

    const [findings] = await db
      .select({
        sightings: sql<number>`count(distinct ${assetEvidenceSources.lastSeenAt})::int`,
        seenBeforeReported: sql<number>`count(*) filter (where ${assetEvidenceSources.lastSeenAt} < ${assetEvidenceSources.firstSeenAt})::int`,
        createdBeforeItsAsset: sql<number>`count(*) filter (where ${assetEvidence.createdAt} < ${supportingAssets.firstSeenAt})::int`,
      })
      .from(assetEvidenceSources)
      .innerJoin(assetEvidence, eq(assetEvidence.id, assetEvidenceSources.assetEvidenceId))
      .innerJoin(supportingAssets, eq(supportingAssets.id, assetEvidence.supportingAssetId))
      .where(GENERATED_ASSET_NAME);
    expect(findings.sightings).toBeGreaterThan(LARGE_ESTATE.assets / 8);
    expect(findings.seenBeforeReported).toBe(0);
    expect(findings.createdBeforeItsAsset).toBe(0);

    const [dismissed] = await db
      .select({
        closedNoLaterThanOpened: sql<number>`count(*) filter (where ${assetEvidence.currentStateSince} <= ${assetEvidence.createdAt})::int`,
      })
      .from(assetEvidence)
      .innerJoin(supportingAssets, eq(supportingAssets.id, assetEvidence.supportingAssetId))
      .where(and(GENERATED_ASSET_NAME, eq(assetEvidence.currentState, 'dismissed')));
    expect(dismissed.closedNoLaterThanOpened).toBe(0);

    // A retirement is learned at a walk of its asset, so none postdates the asset's last one.
    const [retirements] = await db
      .select({
        count: sql<number>`count(*)::int`,
        afterTheLastWalk: sql<number>`count(*) filter (where ${assetEvidenceHistory.stateChangedAt} > ${assetEnumerations.lastReportedAt})::int`,
      })
      .from(assetEvidenceHistory)
      .innerJoin(assetEvidence, eq(assetEvidence.id, assetEvidenceHistory.assetEvidenceId))
      .innerJoin(assetEnumerations, eq(assetEnumerations.supportingAssetId, assetEvidence.supportingAssetId))
      .where(eq(assetEvidenceHistory.origin, 'no_longer_reported'));
    expect(retirements.count).toBeGreaterThan(0);
    expect(retirements.afterTheLastWalk).toBe(0);
  });

  it('should place the findings correction evenly across the park', async () => {
    // The ladder draws two findings per asset and the fixture asks for three, so a third of the
    // total is placed by the correction rather than by the ladder. The pass that reaches the total
    // stops partway through, and in index order its whole residual lands on the low indices, which
    // are a contiguous run of sites.
    const first = await findingsPerAssetBetween(0, LARGE_ESTATE.assets / 4);
    const last = await findingsPerAssetBetween((LARGE_ESTATE.assets * 3) / 4, LARGE_ESTATE.assets);

    expect(Math.abs(first - last) / last).toBeLessThan(0.1);
  });

  it('should seed every finding in the state its sources derive, so a retirement pass adds nothing to it', async () => {
    // Run per tenant, as a connector run is: the pass files what it writes under the run's tenant.
    const assetsByTenant = Map.groupBy(
      await db.selectDistinct({ tenantId: assetEvidence.tenantId, assetId: assetEvidence.supportingAssetId }).from(assetEvidence),
      (row) => row.tenantId,
    );
    const historyRows = async () => (await db.select({ count: sql<number>`count(*)::int` }).from(assetEvidenceHistory))[0].count;
    const before = await historyRows();

    for (const [tenantId, rows] of assetsByTenant) {
      await createTestServices(db).withOrigin({ type: 'job', tenantId, jobKind: 'microsoft-graph-sync', interactive: false }).supportingAssets
        .recomputeEvidenceStateForAssets({ supportingAssetIds: rows.map((row) => row.assetId), reason: 'No longer reported' });
    }

    expect(await historyRows()).toBe(before);
  });

  it('should store on every finding the state and verdict its logs hold, since the seed writes them without its triggers', async () => {
    let outcome: { changed: number, total: number } | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`create temp table stored_before on commit drop as
        select id, current_state, current_state_changed_at, current_state_since, latest_verdict_exposed, latest_verdict_observed_at
        from asset_evidence`);
      await tx.execute(rederiveFindingStates);
      const { rows } = await tx.execute<{ changed: number, total: number }>(sql`
        select count(*) filter (where (e.current_state, e.current_state_changed_at, e.current_state_since, e.latest_verdict_exposed, e.latest_verdict_observed_at)
            is distinct from (b.current_state, b.current_state_changed_at, b.current_state_since, b.latest_verdict_exposed, b.latest_verdict_observed_at))::int as changed,
          count(*)::int as total
        from asset_evidence e join stored_before b on b.id = e.id`);
      outcome = rows[0];
      tx.rollback();
    }).catch((error: unknown) => {
      if (!(error instanceof TransactionRollbackError)) {
        throw error;
      }
    });

    expect(outcome?.total).toBeGreaterThan(0);
    expect(outcome?.changed).toBe(0);
  });
});
