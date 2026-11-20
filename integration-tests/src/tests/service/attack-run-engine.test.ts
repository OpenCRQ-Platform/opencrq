import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, crqIndicatorRuns, crqIndicatorsRepository, cve, mitreTechniquesData, PRICE_RUN_PROFILE } from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AttackRunScenario } from '../../helpers/attack-run-scenario';
import { EXPOSED_ESTATE, LOG4SHELL, recomputeFindingScores, runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * The attack run engine on a real tenant, end to end: it resolves the inputs out of the repositories,
 * evaluates the law over the drawn worlds, and prints everything the product owes.
 *
 * This is the engine's acceptance moment rather than a unit test, so it asserts the shape of every
 * answer and prints the answers themselves. A figure that looks wrong here is a figure a reader can
 * chase, which is what no assertion on its own gives.
 */

const money = (value: number): string => `${Math.round(value).toLocaleString('en-US')} USD`;
const share = (value: number): string => `${(value * 100).toFixed(2)} %`;

/** Curated to exploit through T1068, a local privilege escalation: carried by an internal host it opens no entry, only a floor after the door. */
const PRIVILEGE_ESCALATION_CVE = 'CVE-2021-4034';

/** Listed, reached over the network with a low-privilege account: it opens T1190 at the door and, by the topology rule, T1078 after it. */
const AUTHENTICATED_EDGE_CVE = 'CVE-2099-0002';

describe('the attack run engine on a real tenant', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let riskScenarioId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    ({ riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId));
  });

  it('resolves the inputs, runs, and answers', async () => {
    const { runId, result, reach } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);

    // One row per technique, summed over the actors that hold it, which is what the persisted
    // ranking carries: a technique appearing once per actor reads as a duplicate rather than a rank.
    const summed = new Map<string, { prevent: number, detect: number }>();
    for (const entry of result.techniqueValues) {
      const held = summed.get(entry.techniqueExternalId) ?? { prevent: 0, detect: 0 };
      summed.set(entry.techniqueExternalId, { prevent: held.prevent + entry.preventValue, detect: held.detect + entry.detectValue });
    }
    const techniqueRanking = [...summed]
      .sort((one, other) => (other[1].prevent + other[1].detect) - (one[1].prevent + one[1].detect));

    const lines: Array<string> = [
      '',
      `attack run engine, ${result.worlds} worlds, calibration ${result.calibrationVintage}`,
      `  blocked            ${share(result.outcomes.blocked)}`,
      `  evicted            ${share(result.outcomes.evicted)}`,
      `  impact, noticed    ${share(result.outcomes.impactDetected)}`,
      `  impact, unnoticed  ${share(result.outcomes.impactUndetected)}`,
      `  LEF   mean ${result.lef.mean.toFixed(3)}  p5 ${result.lef.p5.toFixed(3)}  p95 ${result.lef.p95.toFixed(3)}`,
      `  ALE   mean ${money(result.ale.mean)}  p5 ${money(result.ale.p5)}  p95 ${money(result.ale.p95)}`,
      `  ALE with the detection accumulator off ${money(result.calibration.memorylessAle)}`,
      ...result.calibration.cornerConstants.map((corner) => `  at a corner: ${corner}`),
      '  actors',
      ...result.actors.map((actor) => `    ${actor.name} (${actor.actorClass}, ${actor.attackRunDays} days) share ${share(actor.share)}`
        + ` vulnerability ${share(actor.vulnerability.mean)} ALE ${money(actor.aleMean)}`
        + ` reaction time over every remaining window in ${actor.reactionTimeExceededShare === null ? 'no window' : share(actor.reactionTimeExceededShare)} of worlds${
          actor.unplayableObstacleKeys.length === 0 ? '' : ` unplayable: ${actor.unplayableObstacleKeys.join(', ')}`}`),
      '  controls, best move first',
      ...[...result.controlValues]
        .map((control) => ({
          control,
          best: [...control.levers].sort((one, other) => other.aleReduction.mean - one.aleReduction.mean)[0],
        }))
        .sort((one, other) => other.best.aleReduction.mean - one.best.aleReduction.mean)
        .slice(0, 10)
        .map(({ control, best }) => `    ${control.capabilityExternalId.padEnd(6)}`
          + ` ${best.dimension.padEnd(11)} ${money(best.aleReduction.mean).padStart(14)}`
          + ` [p5 ${money(best.aleReduction.p5)} p95 ${money(best.aleReduction.p95)}]`
          + ` ${control.declaredStrengthRung}/${control.declaredCoverageBucket}`
          + ` -> ${best.upgradedStrengthRung}/${best.upgradedCoverageBucket}${
            best.zeroReason === null ? '' : ` (${best.zeroReason})`}`),
      `    ... ${result.controlValues.length} controls in all, `
      + `${result.controlValues.filter((control) => control.levers.every((lever) => lever.zeroReason !== null)).length}`
      + ' zero on every lever by construction',
      '  techniques, most valuable to interdict first',
      ...techniqueRanking.slice(0, 5)
        .map(([externalId, entry]) => `    ${externalId.padEnd(12)} ${money(entry.prevent + entry.detect).padStart(14)}`
          + ` [prevent ${money(entry.prevent)} detect ${money(entry.detect)}]`),
      '  reach',
      `    not contested by this estate     ${reach.uncontestedByEstate.length} pairs`,
      `    not contestable by the catalogue ${reach.uncontestableByCatalogue.length} pairs`,
      `    unscanned assets                 ${share(reach.unscannedAssetShare)} of ${reach.estateAssetCount}`,
      `    catalogue                        ${reach.catalogueVintage}`,
      `    threat relevance                 ${reach.threatRelevance.evidenceMode}, `
      + `${reach.threatRelevance.admittedActorCount} actors`,
      '',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);

    const { blocked, evicted, impactDetected, impactUndetected } = result.outcomes;
    expect(blocked + evicted + impactDetected + impactUndetected).toBeCloseTo(1, 10);
    expect(result.actors).toHaveLength(2);
    expect(result.actors.map((actor) => actor.actorClass)).toContain('state_sponsored');
    expect(result.actors.every((actor) => actor.attackRunDays > 0)).toBe(true);
    expect(result.actors.every((actor) => actor.reactionTimeExceededShare !== null
      && actor.reactionTimeExceededShare >= 0 && actor.reactionTimeExceededShare <= 1)).toBe(true);
    expect(result.controlValues.length).toBeGreaterThan(0);
    expect(result.techniqueValues.length).toBeGreaterThan(0);
    expect(result.techniqueValues.every((value) => value.preventValue >= 0 && value.detectValue >= 0)).toBe(true);
    expect(reach.catalogueVintage).toContain('attack-enterprise');
    expect(reach.estateAssetCount).toBeGreaterThanOrEqual(50);
    expect(reach.unscannedAssetShare).toBe(1);

    const stored = await db.select().from(crqIndicatorRuns).where(eq(crqIndicatorRuns.id, runId));
    expect(stored[0].calibrationVintage).toBe(result.calibrationVintage);
    expect(stored[0].outcomeBlocked).toBeCloseTo(result.outcomes.blocked, 10);
    expect(stored[0].cornerConstants).toEqual([...result.calibration.cornerConstants]);
    expect(stored[0].tefLikely).toBe(1.5);
    expect(stored[0].magnitudeMean).toBeCloseTo(result.magnitude.mean, 10);
    expect(stored[0].magnitudeP10).toBeCloseTo(result.magnitude.p10, 10);
    expect(stored[0].magnitudeP90).toBeCloseTo(result.magnitude.p90, 10);
    expect(stored[0].unscannedAssetCount).toBe(reach.unscannedAssetCount);
    expect(stored[0].estateAssetCount).toBe(reach.estateAssetCount);
    // The header counts the techniques the run scored, so it never promises rows the run has not
    // written: a technique no capability of the catalogue can contest left the run before this.
    const scored = new Set(result.techniqueValues.map((value) => value.techniqueExternalId));
    expect(stored[0].techniqueCount).toBe(scored.size);
    expect(stored[0].coveredTechniqueCount).toBeLessThanOrEqual(stored[0].techniqueCount);
    expect(stored[0].coveredTechniqueCount).toBeGreaterThan(0);

    const latest = await services.withOrigin(adminOrigin).crqIndicators.getLatestRun(riskScenarioId);
    expect(latest?.id).toBe(runId);
  }, 600_000);
});

/**
 * The door reads the estate rather than the actors' CVEs: what a flaw does to the run follows the
 * findings and the tenant's exposure setting. The share of attacks that land, `vulnerability`, is
 * the figure the door gates, and the runs below share one scenario id so they share their worlds:
 * a difference between two of them is the estate's alone.
 */
describe('the attack run door, read from the estate', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  const priced = async (scenario: AttackRunScenario) => {
    const { result } = await runAttackRun(services, adminOrigin, scenario.riskScenarioId, tenantId);
    return { vulnerability: result.vulnerability.mean, ale: result.ale.mean };
  };

  const fix = async (scenario: AttackRunScenario, key: string) => {
    await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
      evidenceId: scenario.findingIdByKey.get(key)!,
      dismissalType: 'risk_accepted',
      reasonCode: 'wont_fix',
      reason: 'Fixed',
      changedByUserId: adminUserId,
    });
    await recomputeFindingScores(services, adminOrigin);
  };

  it('should lower the share that lands and the ALE once the only CISA-listed flaw of the only exposed asset carrying it is fixed', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, EXPOSED_ESTATE);
    const before = await priced(scenario);

    await fix(scenario, 'CVE-2021-44228@Web server 1');
    const after = await priced(scenario);

    process.stdout.write(`door, listed flaw fixed: vulnerability ${before.vulnerability} -> ${after.vulnerability}, ALE ${before.ale} -> ${after.ale}\n`);
    expect(before.vulnerability).toBeGreaterThan(0);
    expect(after.vulnerability).toBeLessThan(before.vulnerability);
    expect(after.ale).toBeLessThan(before.ale);
  }, 600_000);

  it('should lower the share that lands whether or not an admitted actor cites the fixed CVE', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, { ...EXPOSED_ESTATE, actorCves: [LOG4SHELL.cveId] });
    const before = await priced(scenario);

    await fix(scenario, 'CVE-2021-44228@Web server 1');
    const after = await priced(scenario);

    expect(after.vulnerability).toBeLessThan(before.vulnerability);
    expect(after.ale).toBeLessThan(before.ale);
  }, 600_000);

  it('should price a cited CVE that opens no entry at the door, and drop the ALE by what it announced once its finding is dismissed', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      cves: [{ cveId: PRIVILEGE_ESCALATION_CVE, vector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', epss: 0.9, onAssets: ['Crown jewel 1'] }],
      actorCves: [PRIVILEGE_ESCALATION_CVE],
    });
    const { result: before } = await runAttackRun(services, adminOrigin, scenario.riskScenarioId, tenantId);
    const [{ id: cveRowId }] = await db.select({ id: cve.id }).from(cve)
      .where(and(eq(cve.tenantId, tenantId), eq(cve.cveId, PRIVILEGE_ESCALATION_CVE)));
    const whatIf = before.cveValues.find((value) => value.cveId === cveRowId);
    expect(whatIf).toBeDefined();
    expect(whatIf!.aleReductionMean).toBeGreaterThan(0);

    await fix(scenario, `${PRIVILEGE_ESCALATION_CVE}@Crown jewel 1`);
    const { result: after } = await runAttackRun(services, adminOrigin, scenario.riskScenarioId, tenantId);

    const announced = whatIf!.aleReductionMean;
    const observed = before.ale.mean - after.ale.mean;
    process.stdout.write(`floor-only what-if agreement: announced ${announced}, observed ${observed}, gap ${Math.abs(observed - announced)} (${Math.abs(observed - announced) / before.ale.mean} of the ALE)\n`);
    expect(Math.abs(observed - announced)).toBeLessThan(1e-6 * before.ale.mean);
  }, 600_000);

  it('should drop the ALE by what the CVE\'s what-if announced once every finding of the CVE is dismissed', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      assets: [{ name: 'Web server', categoryId: 'host', exposure: 'internet_facing', criticality: 'medium', count: 2 }],
      cves: [{
        cveId: AUTHENTICATED_EDGE_CVE,
        vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
        epss: 0.9,
        kev: true,
        onAssets: ['Web server 1', 'Web server 2'],
      }],
      actorCves: [AUTHENTICATED_EDGE_CVE],
    });
    const { result: before } = await runAttackRun(services, adminOrigin, scenario.riskScenarioId, tenantId);
    const [{ id: cveRowId }] = await db.select({ id: cve.id }).from(cve)
      .where(and(eq(cve.tenantId, tenantId), eq(cve.cveId, AUTHENTICATED_EDGE_CVE)));
    const whatIf = before.cveValues.find((value) => value.cveId === cveRowId);
    expect(whatIf).toBeDefined();

    await fix(scenario, `${AUTHENTICATED_EDGE_CVE}@Web server 1`);
    await fix(scenario, `${AUTHENTICATED_EDGE_CVE}@Web server 2`);
    const { result: after } = await runAttackRun(services, adminOrigin, scenario.riskScenarioId, tenantId);

    const announced = whatIf!.aleReductionMean;
    const observed = before.ale.mean - after.ale.mean;
    process.stdout.write(`what-if agreement: announced ${announced}, observed ${observed}, gap ${Math.abs(observed - announced)} (${Math.abs(observed - announced) / before.ale.mean} of the ALE)\n`);
    expect(announced).toBeGreaterThan(0);
    expect(Math.abs(observed - announced)).toBeLessThan(1e-6 * before.ale.mean);
  }, 600_000);

  describe('an asset carrying one cited CVE through two findings', () => {
    const seedTwoFindings = async () => {
      const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, {
        cves: [{ cveId: PRIVILEGE_ESCALATION_CVE, vector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', epss: 0.9, onAssets: ['Crown jewel 1'] }],
        actorCves: [PRIVILEGE_ESCALATION_CVE],
      });
      // The unique key of a finding includes the platform type, which no helper sets: a second report of the CVE needs its own row.
      const secondId = uuidv7();
      const first = scenario.findingIdByKey.get(`${PRIVILEGE_ESCALATION_CVE}@Crown jewel 1`)!;
      const [{ cveId, supportingAssetId }] = await db.select({ cveId: assetEvidence.cveId, supportingAssetId: assetEvidence.supportingAssetId })
        .from(assetEvidence).where(eq(assetEvidence.id, first));
      await db.insert(assetEvidence).values([{ id: secondId, supportingAssetId, tenantId, cveId, securityPlatformType: 'second-scanner', userId: adminUserId }]);
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), tenantId, assetEvidenceId: secondId, stateChangedAt: new Date(), state: 'applicable', origin: 'user', changedByUserId: adminUserId,
      }]);
      await recomputeFindingScores(services, adminOrigin);
      return { scenario, first, second: secondId };
    };

    const dismiss = async (evidenceId: string) => {
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Fixed',
        changedByUserId: adminUserId,
      });
      await recomputeFindingScores(services, adminOrigin);
    };

    it('should keep the floor of the CVE while one of the two findings stays applicable', async () => {
      const { scenario, second } = await seedTwoFindings();
      const before = await priced(scenario);

      await dismiss(second);
      const after = await priced(scenario);

      expect(after.ale).toBe(before.ale);
    }, 600_000);

    it('should drop the floor of the CVE once both findings are dismissed', async () => {
      const { scenario, first, second } = await seedTwoFindings();
      const before = await priced(scenario);

      await dismiss(second);
      await dismiss(first);
      const after = await priced(scenario);

      expect(after.ale).toBeLessThan(before.ale);
    }, 600_000);
  });

  it('should open T1190 on the assets of unknown exposure once the tenant counts them as internet-facing', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      assets: [{ name: 'Legacy host', categoryId: 'host', exposure: 'unknown', criticality: 'medium', count: 3 }],
      cves: [{ ...LOG4SHELL, onAssets: ['Legacy host 1', 'Legacy host 2', 'Legacy host 3'] }],
    });
    const internal = await priced(scenario);

    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });
    await recomputeFindingScores(services, adminOrigin);
    const exposed = await priced(scenario);

    process.stdout.write(`door, unknown exposure counted internet-facing: vulnerability ${internal.vulnerability} -> ${exposed.vulnerability}, ALE ${internal.ale} -> ${exposed.ale}\n`);
    expect(exposed.vulnerability).toBeGreaterThan(internal.vulnerability);
    expect(exposed.ale).toBeGreaterThan(internal.ale);
  }, 600_000);

  const legacyHosts = ['Legacy host 1', 'Legacy host 2', 'Legacy host 3'];
  const legacyEstate = {
    assets: [{ name: 'Legacy host', categoryId: 'host', exposure: 'unknown', criticality: 'medium', count: 3 }],
    cves: [{ ...LOG4SHELL, onAssets: legacyHosts }],
  } as const;

  it('should move the door with the unknown exposure setting although no recompute ran since the change', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, legacyEstate);
    const internal = await priced(scenario);

    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });
    const exposed = await priced(scenario);

    expect(exposed.vulnerability).toBeGreaterThan(internal.vulnerability);
    expect(exposed.ale).toBeGreaterThan(internal.ale);
  }, 600_000);

  it('should not price a finding dismissed since the last recompute', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, legacyEstate);
    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });
    const before = await priced(scenario);

    for (const host of legacyHosts) {
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: scenario.findingIdByKey.get(`CVE-2021-44228@${host}`)!,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Fixed',
        changedByUserId: adminUserId,
      });
    }
    const after = await priced(scenario);

    expect(after.vulnerability).toBeLessThan(before.vulnerability);
  }, 600_000);

  it('should price an estate with nothing exposed and no finding through the unknown flaw floor alone', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId);

    const naked = await priced(scenario);

    expect(naked.vulnerability).toBeGreaterThan(0);
    expect(naked.vulnerability).toBeLessThan(0.2);
  }, 600_000);
});

/**
 * The unknown settings weigh the groups the attacker moves through. An unknown exposure on a family
 * no entry technique of the door applies to leaves the door's success alone, so what the setting
 * moves is how the estate shares the later steps and the detection.
 */
describe('the unknown settings along the attack path', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
  });

  const doorAndAle = async (riskScenarioId: string) => {
    const { result } = await runAttackRun(services, adminOrigin, riskScenarioId, tenantId);
    return { stoppedAtDoor: result.paths.stoppedAtInitialAccess, ale: result.ale.mean };
  };

  // An identity is a family T1190 and T1133 do not reach, and one with no subcategory opens no other entry technique.
  it('should move the ALE past the door with the unknown exposure setting, the door unchanged', async () => {
    const { riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      assets: [
        { name: 'Web server', categoryId: 'host', exposure: 'internet_facing', criticality: 'medium', count: 2 },
        { name: 'Unclassified identity', categoryId: 'identity', exposure: 'unknown', criticality: 'high', count: 6 },
      ],
    });
    const internal = await doorAndAle(riskScenarioId);

    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });
    const exposed = await doorAndAle(riskScenarioId);

    process.stdout.write(`path, unknown exposure counted internet-facing: stopped at the door ${internal.stoppedAtDoor} -> ${exposed.stoppedAtDoor}, ALE ${internal.ale} -> ${exposed.ale}\n`);
    expect(exposed.stoppedAtDoor).toBe(internal.stoppedAtDoor);
    expect(exposed.ale).not.toBe(internal.ale);
  }, 600_000);

  // Criticality weighs nothing at the door, so the setting can only move how the estate shares the later steps.
  it('should move the ALE past the door with the unknown criticality setting, the door unchanged', async () => {
    const { riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      assets: [{ name: 'Legacy host', categoryId: 'host', exposure: 'internal', criticality: 'unknown', count: 8 }],
    });
    const low = await doorAndAle(riskScenarioId);

    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownCriticalityCountsAs: 'very_high' });
    const veryHigh = await doorAndAle(riskScenarioId);

    process.stdout.write(`path, unknown criticality counted very high: stopped at the door ${low.stoppedAtDoor} -> ${veryHigh.stoppedAtDoor}, ALE ${low.ale} -> ${veryHigh.ale}\n`);
    expect(veryHigh.stoppedAtDoor).toBe(low.stoppedAtDoor);
    expect(veryHigh.ale).not.toBe(low.ale);
  }, 600_000);
});

/**
 * An admitted actor citing a CVE an asset carries raises its success on that asset to the CVE floor,
 * on the steps after the door, for as long as the finding stays applicable.
 */
describe('the actors\' CVE floors, read from the findings', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  // A local flaw needing no user: the topology rule gives it T1068 alone, so it opens nothing at
  // the door and what it moves is the floor.
  const privilegeEscalation = { cveId: 'CVE-2099-1068', vector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', epss: 0.05 };
  const crownJewels = ['Crown jewel 1', 'Crown jewel 2', 'Crown jewel 3', 'Crown jewel 4'];

  const priced = async (scenario: AttackRunScenario) => {
    const { result } = await runAttackRun(services, adminOrigin, scenario.riskScenarioId, tenantId, PRICE_RUN_PROFILE);
    return { ale: result.ale.mean, stoppedAtInitialAccess: result.paths.stoppedAtInitialAccess };
  };

  it('should drop the floor of a dismissed finding and give it back once the finding is reopened', async () => {
    const scenario = await seedAttackRunScenario(services, adminOrigin, tenantId, {
      cves: [{ ...privilegeEscalation, onAssets: crownJewels }],
      actorCves: [privilegeEscalation.cveId],
    });
    const findingIds = crownJewels.map((name) => scenario.findingIdByKey.get(`${privilegeEscalation.cveId}@${name}`)!);
    const applicable = await priced(scenario);

    for (const evidenceId of findingIds) {
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Accepted',
        changedByUserId: adminUserId,
      });
    }
    const dismissed = await priced(scenario);

    for (const evidenceId of findingIds) {
      await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({ evidenceId, changedByUserId: adminUserId });
    }
    const reopened = await priced(scenario);

    process.stdout.write(`actor CVE floor, finding dismissed then reopened: ALE ${applicable.ale} -> ${dismissed.ale} -> ${reopened.ale}\n`);
    expect(dismissed.stoppedAtInitialAccess).toBe(applicable.stoppedAtInitialAccess);
    expect(dismissed.ale).toBeLessThan(applicable.ale);
    expect(reopened).toEqual(applicable);
  }, 600_000);
});

/**
 * A control stands at a stage of a phishing campaign by its prevent edge on the stage's technique,
 * so the control inputs carry those edges although the repertoire plays none of the techniques.
 */
describe('the control inputs of a run', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    ({ organizationId } = await seedAttackRunScenario(services, adminOrigin, tenantId));
  });

  it('should read the prevent edges of the phishing stages although the repertoire plays none of their techniques', async () => {
    const repertoire = mitreTechniquesData.filter((technique) => technique.externalId === 'T1486').map((technique) => technique.id);
    const controls = await crqIndicatorsRepository.findAttackRunControlInputs(repositoryContextOf(db, adminOrigin), repertoire, tenantId, organizationId);
    const preventOf = (capabilityExternalId: string) => controls.find((control) => control.capabilityExternalId === capabilityExternalId)?.preventTechniqueExternalIds;

    expect(preventOf('SAT')).toEqual(expect.arrayContaining(['T1566', 'T1204']));
    expect(preventOf('IDP')).toContain('T1078');
    expect(preventOf('UEM')).toContain('T1204');
    expect(preventOf('PATCH')).toContain('T1203');
  });

  // The catalogue carries every sub-technique edge with its parent's, so only a tenant addition holds one alone.
  it('should read a prevent edge a control holds on a stage sub-technique alone', async () => {
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    const seb = capabilities.find((capability) => capability.externalId === 'SEB')!;
    const spearphishingLink = mitreTechniquesData.find((technique) => technique.externalId === 'T1566.002')!;
    await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(seb.id, spearphishingLink.id, 'prevent');
    const repertoire = mitreTechniquesData.filter((technique) => technique.externalId === 'T1486').map((technique) => technique.id);
    const controls = await crqIndicatorsRepository.findAttackRunControlInputs(repositoryContextOf(db, adminOrigin), repertoire, tenantId, organizationId);
    const preventOf = (capabilityExternalId: string) => controls.find((control) => control.capabilityExternalId === capabilityExternalId)?.preventTechniqueExternalIds;

    expect(preventOf('SEB')).toContain('T1566.002');
    expect(preventOf('SEB')).not.toContain('T1566');
  });

  it('should leave the detect edges of the phishing stages out when the repertoire plays none of their techniques', async () => {
    const repertoire = mitreTechniquesData.filter((technique) => technique.externalId === 'T1486').map((technique) => technique.id);
    const controls = await crqIndicatorsRepository.findAttackRunControlInputs(repositoryContextOf(db, adminOrigin), repertoire, tenantId, organizationId);
    const stage = new Set(['T1566', 'T1078', 'T1204', 'T1203']);

    expect(controls.find((control) => control.capabilityExternalId === 'EDR')).toBeDefined();
    for (const control of controls) {
      expect(control.detectTechniqueExternalIds.filter((externalId) => stage.has(externalId))).toEqual([]);
    }
  });

  it('should read a stage technique the repertoire plays on both functions', async () => {
    const repertoire = mitreTechniquesData.filter((technique) => technique.externalId === 'T1566').map((technique) => technique.id);
    const controls = await crqIndicatorsRepository.findAttackRunControlInputs(repositoryContextOf(db, adminOrigin), repertoire, tenantId, organizationId);

    expect(controls.find((control) => control.capabilityExternalId === 'EDR')?.detectTechniqueExternalIds).toContain('T1566');
  });
});
