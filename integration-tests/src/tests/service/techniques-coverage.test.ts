import type { CapabilityFunction, EventOrigin, TechniqueControlTestReading, TechniqueFunctionCoverage } from '@app/module';
import { controlTechniqueTestResults, mitreTechniquesData, STRENGTH_BY_RUNG, TECHNIQUE_T1055, threatAnalyses } from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { ABOVE_GATE, buildParsedEntry, THREAT_ID, UNKNOWN_MITRE_TECHNIQUE_ID } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const techniqueId = (externalId: string): string => mitreTechniquesData.find((technique) => technique.externalId === externalId)!.id;
const externalIdOf = (mitreTechniqueId: string): string => mitreTechniquesData.find((technique) => technique.id === mitreTechniqueId)!.externalId;
const TECHNIQUE_T1055_012 = techniqueId('T1055.012');
const TECHNIQUE_T1059 = techniqueId('T1059');
const TECHNIQUE_T1566 = techniqueId('T1566');

/** L2 strength and L2 coverage on the engine's scale, about 50 %. */
const DECLARED = STRENGTH_BY_RUNG.L2 * 0.7;

interface StoredResult {
  capabilityId: string,
  mitreTechniqueId: string,
  grain?: 'technique' | 'sub_technique',
  fn?: CapabilityFunction,
  organizationId?: string | null,
  heldTests: number,
  tests: number,
  hostsTested: number,
  scopeHosts?: number,
}

describe('a threat\'s techniques covered by their best control', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;
  let scopeId: string;

  const scoped = (origin: EventOrigin = adminOrigin) => services.withOrigin(origin);
  /** A threat claiming each technique above the confidence gate, then each external id of `claimed` as stated. */
  const threatPlaying = async (
    techniqueIds: Array<string>,
    claimed: Array<{ externalId: string, relConfidence: number }> = [],
    origin: EventOrigin = adminOrigin,
  ): Promise<string> => {
    const entry = buildParsedEntry();
    const [template] = entry.techniques;
    const claims = [...techniqueIds.map((id) => ({ externalId: externalIdOf(id), relConfidence: ABOVE_GATE })), ...claimed];
    entry.techniques = claims.map(({ externalId, relConfidence }) => ({
      ...template,
      stixId: `attack-pattern--${externalId}`,
      stixRelationId: `relationship--${externalId}`,
      name: externalId,
      mitreExternalId: externalId,
      relConfidence,
    }));
    const tenant = 'tenantId' in origin ? origin.tenantId : tenantId;
    await scoped(origin).threatAnalyses.ingestBundle([entry], tenant, 'stix-import');
    const [{ id }] = await db.select({ id: threatAnalyses.id }).from(threatAnalyses)
      .where(and(eq(threatAnalyses.tenantId, tenant), eq(threatAnalyses.stixId, THREAT_ID)));
    return id;
  };
  const coverage = async (techniqueIds: Array<string>, level: string | null = null, origin: EventOrigin = adminOrigin) =>
    scoped(origin).controlValidation.getTechniquesCoverage(await threatPlaying(techniqueIds, [], origin), level);
  const on = (coverages: Array<TechniqueFunctionCoverage>, mitreTechniqueId: string, fn: CapabilityFunction = 'prevent'): TechniqueFunctionCoverage =>
    coverages.find((entry) => entry.mitreTechniqueId === mitreTechniqueId && entry.function === fn)!;
  const named = (reading: TechniqueControlTestReading | null): string | null => reading?.capabilityExternalId ?? null;
  const store = ({ capabilityId, mitreTechniqueId, grain = 'technique', fn = 'prevent', organizationId = null, heldTests, tests, hostsTested, scopeHosts = 20 }: StoredResult, tenant = tenantId) =>
    db.insert(controlTechniqueTestResults).values([{
      id: uuidv7(),
      tenantId: tenant,
      capabilityId,
      organizationId,
      function: fn,
      mitreTechniqueId,
      grain,
      rate: heldTests / tests,
      tests,
      heldTests,
      hostsTested,
      scopeHosts,
    }]);
  /** The controls with an edge the engine scores on the technique and function, by catalogue id. */
  const coveringControls = async (mitreTechniqueId: string, fn: CapabilityFunction = 'prevent') =>
    (await scoped().controlCapabilities.getCapabilitiesForTechnique(mitreTechniqueId))
      .filter((control) => control.function === fn && control.state !== 'removed' && control.inheritedFrom === null)
      .map((control) => ({ id: control.id, externalId: control.externalId }))
      .sort((first, second) => first.externalId.localeCompare(second.externalId));
  const twoCoveringControls = async (mitreTechniqueId: string) => {
    const [first, second] = await coveringControls(mitreTechniqueId);
    expect(second).toBeDefined();
    return { first, second };
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
    scopeId = uuidv7();
    await scoped().organizations.createOrganizations([{ id: scopeId, name: 'Whole estate' }]);
  });

  it('should read every technique and function exactly as the technique page reads it, the best control first', async () => {
    const { first, second } = await twoCoveringControls(TECHNIQUE_T1059);
    await scoped().controlCapabilities.upsertAssessment(first.id, 'L2', 'L2', null);
    await scoped().controlCapabilities.upsertAssessment(second.id, 'L3', 'L1', null);
    await store({ capabilityId: first.id, mitreTechniqueId: TECHNIQUE_T1059, heldTests: 1, tests: 4, hostsTested: 4 });
    await store({ capabilityId: first.id, mitreTechniqueId: TECHNIQUE_T1566, heldTests: 0, tests: 1, hostsTested: 1 });
    const techniques = [TECHNIQUE_T1059, TECHNIQUE_T1055, TECHNIQUE_T1055_012, TECHNIQUE_T1566];

    const coverages = await coverage(techniques);

    expect(coverages).toHaveLength(techniques.length * 2);
    const byControl = (readings: Array<TechniqueControlTestReading>) =>
      readings.toSorted((one, other) => `${one.capabilityExternalId}|${one.function}`.localeCompare(`${other.capabilityExternalId}|${other.function}`));
    for (const mitreTechniqueId of techniques) {
      const page = await scoped().controlValidation.getTechniqueTestReadings(mitreTechniqueId, null);
      const read = coverages
        .filter((entry) => entry.mitreTechniqueId === mitreTechniqueId)
        .flatMap((entry) => (entry.best === null ? entry.others : [entry.best, ...entry.others]))
        .map(({ linked: _linkedOnTheThreatTabOnly, removedOn: _removedOnTheThreatTabOnly, ...reading }) => reading);
      expect(byControl(read)).toEqual(byControl(page));
    }
  });

  it('should take the control with the highest efficacy as the best one, the tests deciding over the declaration', async () => {
    const { first, second } = await twoCoveringControls(TECHNIQUE_T1059);
    await scoped().controlCapabilities.upsertAssessment(first.id, 'L2', 'L2', null);
    await scoped().controlCapabilities.upsertAssessment(second.id, 'L3', 'L2', null);

    expect(named(on(await coverage([TECHNIQUE_T1059]), TECHNIQUE_T1059).best)).toBe(second.externalId);

    // Every host tested, every test failed: the declaration falls to 0.
    await store({ capabilityId: second.id, mitreTechniqueId: TECHNIQUE_T1059, heldTests: 0, tests: 20, hostsTested: 20 });
    const lowered = on(await coverage([TECHNIQUE_T1059]), TECHNIQUE_T1059);

    expect(named(lowered.best)).toBe(first.externalId);
    expect(lowered.others.find((reading) => reading.capabilityId === second.id)).toMatchObject({ covered: true, efficacy: 0 });
  });

  it('should break a tie on the catalogue id', async () => {
    const { first, second } = await twoCoveringControls(TECHNIQUE_T1059);
    await scoped().controlCapabilities.upsertAssessment(second.id, 'L2', 'L2', null);
    await scoped().controlCapabilities.upsertAssessment(first.id, 'L2', 'L2', null);

    const { best, others } = on(await coverage([TECHNIQUE_T1059]), TECHNIQUE_T1059);

    expect(named(best)).toBe(first.externalId);
    expect(others[0]).toMatchObject({ capabilityId: second.id, efficacy: best!.efficacy });
  });

  it('should never take a control declared at no coverage, which the engine reads as absent', async () => {
    const { first, second } = await twoCoveringControls(TECHNIQUE_T1059);
    await scoped().controlCapabilities.upsertAssessment(first.id, 'L3', 'L0', null);

    const alone = on(await coverage([TECHNIQUE_T1059]), TECHNIQUE_T1059);
    expect(alone.best).toBeNull();
    expect(alone.others.find((reading) => reading.capabilityId === first.id)).toMatchObject({ covered: true, declared: 0 });

    await scoped().controlCapabilities.upsertAssessment(second.id, 'L1', 'L1', null);
    expect(named(on(await coverage([TECHNIQUE_T1059]), TECHNIQUE_T1059).best)).toBe(second.externalId);
  });

  it('should read a sub-technique on its own result, naming the efficacy the engine prices on its parent', async () => {
    const edrId = (await coveringControls(TECHNIQUE_T1055)).find((control) => control.externalId === 'EDR')!.id;
    await scoped().controlCapabilities.upsertAssessment(edrId, 'L2', 'L2', null);
    await store({ capabilityId: edrId, mitreTechniqueId: TECHNIQUE_T1055_012, grain: 'sub_technique', heldTests: 0, tests: 1, hostsTested: 1 });
    await store({ capabilityId: edrId, mitreTechniqueId: TECHNIQUE_T1055, heldTests: 1, tests: 2, hostsTested: 2 });

    const coverages = await coverage([TECHNIQUE_T1055_012]);
    const edr = [on(coverages, TECHNIQUE_T1055_012).best, ...on(coverages, TECHNIQUE_T1055_012).others].find((reading) => reading?.capabilityId === edrId);

    expect(edr).toMatchObject({
      covered: true,
      mitreTechniqueId: TECHNIQUE_T1055_012,
      familyTechniqueId: TECHNIQUE_T1055,
      efficacy: expect.closeTo(DECLARED * 0.95, 12),
      tested: { tests: 1, heldTests: 0, hostsTested: 1, scopeHosts: 20 },
      parentEfficacy: expect.closeTo(DECLARED - 0.1 * (DECLARED - 0.5), 12),
    });
    expect(coverages.every((entry) => entry.mitreTechniqueId === TECHNIQUE_T1055_012)).toBe(true);
  });

  it('should read a technique no assessed control covers with no best control, a control tested there listed as not covered', async () => {
    const edrId = (await coveringControls(TECHNIQUE_T1055)).find((control) => control.externalId === 'EDR')!.id;
    expect((await coveringControls(TECHNIQUE_T1566)).map((control) => control.id)).not.toContain(edrId);
    await scoped().controlCapabilities.upsertAssessment(edrId, 'L2', 'L2', null);
    await store({ capabilityId: edrId, mitreTechniqueId: TECHNIQUE_T1566, heldTests: 0, tests: 1, hostsTested: 1 });

    const { best, others } = on(await coverage([TECHNIQUE_T1566]), TECHNIQUE_T1566);

    expect(best).toBeNull();
    expect(others.find((reading) => reading.capabilityId === edrId)).toMatchObject({ covered: false, linked: false, removedOn: null, tested: { tests: 1, heldTests: 0 } });
  });

  it('should read a tested control the tenant unlinked from the technique as removed there', async () => {
    const edrId = (await coveringControls(TECHNIQUE_T1055)).find((control) => control.externalId === 'EDR')!.id;
    await scoped().controlCapabilities.removeTechnique(edrId, TECHNIQUE_T1055, 'prevent');
    await scoped().controlCapabilities.upsertAssessment(edrId, 'L2', 'L2', null);
    await store({ capabilityId: edrId, mitreTechniqueId: TECHNIQUE_T1055, heldTests: 0, tests: 1, hostsTested: 1 });

    const { others } = on(await coverage([TECHNIQUE_T1055]), TECHNIQUE_T1055);

    expect(others.find((reading) => reading.capabilityId === edrId)).toMatchObject({ covered: false, linked: false, removedOn: 'technique' });
  });

  it('should read a sub-technique\'s control the tenant unlinked from its parent as removed on the parent', async () => {
    const onChild = new Set((await coveringControls(TECHNIQUE_T1055_012, 'detect')).map(({ id }) => id));
    const control = (await coveringControls(TECHNIQUE_T1055, 'detect')).find(({ id }) => !onChild.has(id))!;
    await scoped().controlCapabilities.removeTechnique(control.id, TECHNIQUE_T1055, 'detect');
    await scoped().controlCapabilities.upsertAssessment(control.id, 'L2', 'L2', null);
    await store({ capabilityId: control.id, mitreTechniqueId: TECHNIQUE_T1055_012, grain: 'sub_technique', fn: 'detect', heldTests: 0, tests: 1, hostsTested: 1 });

    const { others } = on(await coverage([TECHNIQUE_T1055_012]), TECHNIQUE_T1055_012, 'detect');

    expect(others.find((reading) => reading.capabilityId === control.id)).toMatchObject({ covered: false, linked: false, removedOn: 'parent' });
  });

  it('should read a tested control linked on a sub-technique alone as linked, the engine pricing its parent without it', async () => {
    const onParent = new Set((await scoped().controlCapabilities.getCapabilitiesForTechnique(TECHNIQUE_T1055)).map((control) => control.id));
    const onChild = new Set((await scoped().controlCapabilities.getCapabilitiesForTechnique(TECHNIQUE_T1055_012)).map((control) => control.id));
    const control = (await coveringControls(TECHNIQUE_T1566)).find(({ id }) => !onParent.has(id) && !onChild.has(id))!;
    await scoped().controlCapabilities.addTechnique(control.id, TECHNIQUE_T1055_012, 'prevent');
    await scoped().controlCapabilities.upsertAssessment(control.id, 'L2', 'L2', null);
    await store({ capabilityId: control.id, mitreTechniqueId: TECHNIQUE_T1055_012, grain: 'sub_technique', heldTests: 0, tests: 1, hostsTested: 1 });

    const { others } = on(await coverage([TECHNIQUE_T1055_012]), TECHNIQUE_T1055_012);

    expect(others.find((reading) => reading.capabilityId === control.id)).toMatchObject({ covered: false, linked: true, tested: { tests: 1, heldTests: 0 } });
  });

  it('should read a risk scope on its own declaration and results', async () => {
    const edrId = (await coveringControls(TECHNIQUE_T1055)).find((control) => control.externalId === 'EDR')!.id;
    await scoped().controlCapabilities.upsertAssessment(edrId, 'L2', 'L2', null);
    await scoped().controlCapabilities.declareScopePosture(scopeId, edrId, { strengthRung: 'L3', coverageBucket: null, comment: null });
    await store({ capabilityId: edrId, mitreTechniqueId: TECHNIQUE_T1055, organizationId: scopeId, heldTests: 0, tests: 5, hostsTested: 5 });

    const inScope = on(await coverage([TECHNIQUE_T1055], scopeId), TECHNIQUE_T1055);
    const atTenant = on(await coverage([TECHNIQUE_T1055], null), TECHNIQUE_T1055);
    const edrIn = (entry: TechniqueFunctionCoverage) => [entry.best, ...entry.others].find((reading) => reading?.capabilityId === edrId);

    const scopeDeclared = STRENGTH_BY_RUNG.L3 * 0.7;
    expect(edrIn(inScope)).toMatchObject({ declared: scopeDeclared, efficacy: expect.closeTo(scopeDeclared * 0.75, 12), tested: { tests: 5, scopeHosts: 20 } });
    expect(edrIn(atTenant)).toMatchObject({ declared: DECLARED, efficacy: DECLARED, tested: null });
  });

  it('should read another tenant on its own results alone, and refuse it this tenant\'s scope', async () => {
    const edrId = (await coveringControls(TECHNIQUE_T1055)).find((control) => control.externalId === 'EDR')!.id;
    await scoped().controlCapabilities.upsertAssessment(edrId, 'L2', 'L2', null);
    await store({ capabilityId: edrId, mitreTechniqueId: TECHNIQUE_T1055, heldTests: 0, tests: 4, hostsTested: 4 });
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    const theirs = on(await coverage([TECHNIQUE_T1055], null, otherOrigin), TECHNIQUE_T1055);
    expect(theirs.best).toBeNull();
    expect(theirs.others.every((reading) => reading.tested === null)).toBe(true);
    await expect(coverage([TECHNIQUE_T1055], scopeId, otherOrigin)).rejects.toThrow();
  });

  it('should read the catalogue techniques the threat plays above the confidence gate, each once', async () => {
    const threatId = await threatPlaying([TECHNIQUE_T1059, TECHNIQUE_T1055_012], [
      { externalId: UNKNOWN_MITRE_TECHNIQUE_ID, relConfidence: ABOVE_GATE },
      { externalId: 'T1566', relConfidence: ABOVE_GATE - 1 },
    ]);

    const coverages = await scoped().controlValidation.getTechniquesCoverage(threatId, null);

    expect(coverages.map((entry) => `${externalIdOf(entry.mitreTechniqueId)}|${entry.function}`).sort())
      .toEqual(['T1055.012|detect', 'T1055.012|prevent', 'T1059|detect', 'T1059|prevent']);
  });

  it('should read nothing of a threat another tenant holds', async () => {
    const threatId = await threatPlaying([TECHNIQUE_T1059]);
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    expect(await scoped(otherOrigin).controlValidation.getTechniquesCoverage(threatId, null)).toEqual([]);
    expect(await scoped().controlValidation.getTechniquesCoverage(threatId, null)).toHaveLength(2);
  });
});
