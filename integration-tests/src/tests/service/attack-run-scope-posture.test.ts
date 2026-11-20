import type { CrqRunProfile, EventOrigin } from '@app/module';
import { controlCapabilities, controlCapabilityAssessments, controlCapabilityEdges, leversRunProfile, PRICE_RUN_PROFILE } from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { EXPOSED_ESTATE, runAttackRun, seedAttackRunScenario } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('the attack run engine against a scope’s declared posture', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let riskScenarioId: string;

  const scoped = () => services.withOrigin(adminOrigin);
  const run = (profile: CrqRunProfile) => runAttackRun(services, adminOrigin, riskScenarioId, tenantId, profile);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId));
  });

  it('should price a scope carrying no override exactly as before, to the cent', async () => {
    const before = await run(PRICE_RUN_PROFILE);

    // The loudest override there is, on a scope this scenario does not belong to.
    const otherScopeId = uuidv7();
    await scoped().organizations.createOrganizations([{ id: otherScopeId, name: 'Somewhere else' }]);
    for (const control of await db.select({ id: controlCapabilities.id }).from(controlCapabilities)) {
      await scoped().controlCapabilities.declareScopePosture(otherScopeId, control.id, {
        strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      });
    }

    const after = await run(PRICE_RUN_PROFILE);

    expect(after.result.ale.mean).toBeCloseTo(before.result.ale.mean, 2);
    expect(after.result.ale.p5).toBeCloseTo(before.result.ale.p5, 2);
    expect(after.result.ale.p95).toBeCloseTo(before.result.ale.p95, 2);
    expect(after.result.outcomes).toEqual(before.result.outcomes);
  });

  it('should owe a recompute to every control the run actually prices', async () => {
    const { result } = await run(leversRunProfile('all'));
    const pricedControlIds = result.controlValues.map((control) => control.controlId);
    expect(pricedControlIds.length).toBeGreaterThan(0);

    const priced = await scoped().crqIndicators
      .getScenariosPricedAgainstCapabilities(pricedControlIds, organizationId, tenantId);
    const owed = priced.find((scenario) => scenario.riskScenarioId === riskScenarioId)?.controlIds ?? [];

    expect(pricedControlIds.filter((controlId) => !owed.includes(controlId))).toEqual([]);
  });

  it('should price a scope strictly higher once a contesting control is forced to coverage none', async () => {
    // A control is worth something only where the estate gives the door something to pass.
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    ({ organizationId, riskScenarioId } = await seedAttackRunScenario(services, adminOrigin, tenantId, EXPOSED_ESTATE));
    // The door here is T1190 on the exposed web server, so only a declared control preventing it can contest it.
    const candidates = await db.select({ id: controlCapabilityAssessments.capabilityId }).from(controlCapabilityAssessments)
      .innerJoin(controlCapabilityEdges, and(
        eq(controlCapabilityEdges.capabilityId, controlCapabilityAssessments.capabilityId),
        eq(controlCapabilityEdges.techniqueExternalId, 'T1190'),
        eq(controlCapabilityEdges.function, 'prevent'),
      ))
      .where(eq(controlCapabilityAssessments.tenantId, tenantId));
    const before = await run(leversRunProfile(candidates.map((control) => control.id)));

    const contesting = [...before.result.controlValues]
      .filter((control) => control.declaredCoverageBucket !== 'L0' && control.declaredStrengthRung !== 'L0')
      .map((control) => ({
        control,
        worth: Math.max(...control.levers.map((lever) => lever.aleReduction.mean)),
      }))
      .sort((one, other) => other.worth - one.worth)[0];
    expect(contesting.worth).toBeGreaterThan(0);

    await scoped().controlCapabilities.declareScopePosture(organizationId, contesting.control.controlId, {
      strengthRung: null, coverageBucket: 'L0', comment: 'not deployed on this perimeter',
    });

    const after = await run(leversRunProfile([contesting.control.controlId]));

    const forced = after.result.controlValues.find((control) => control.controlId === contesting.control.controlId);
    expect(forced?.declaredCoverageBucket).toBe('L0');
    expect(forced?.declaredStrengthRung).toBe(contesting.control.declaredStrengthRung);
    expect(after.result.ale.mean).toBeGreaterThan(before.result.ale.mean);
    expect(after.result.ale.p5).toBeGreaterThan(before.result.ale.p5);
  });
});
