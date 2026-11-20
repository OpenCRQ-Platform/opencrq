import type { EventOrigin } from '@app/module';
import {
  TECHNIQUE_T1005,
  TECHNIQUE_T1078,
  TECHNIQUE_T1078_004,
  TECHNIQUE_T1583,
} from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Controls read from a technique', () => {
  let adminOrigin: EventOrigin;
  let idpId: string;

  const controlsFor = (techniqueId: string) =>
    services.withOrigin(adminOrigin).controlCapabilities.getCapabilitiesForTechnique(techniqueId);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    idpId = capabilities.find((c) => c.externalId === 'IDP')!.id;
  });

  it('answers with the controls the catalogue maps to the technique, each on its own function', async () => {
    const controls = await controlsFor(TECHNIQUE_T1078);

    const idp = controls.find((c) => c.externalId === 'IDP' && c.function === 'prevent');
    expect(idp).toMatchObject({ source: 'catalogue', state: 'recommended', inheritedFrom: null });
    expect(controls.every((c) => c.function === 'prevent' || c.function === 'detect')).toBe(true);
  });

  it('carries the tenant assessment, and null until the tenant declares one', async () => {
    expect((await controlsFor(TECHNIQUE_T1078)).find((c) => c.externalId === 'IDP')!.assessment).toBeNull();

    await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idpId, 'L3', 'L2', null);

    const assessed = (await controlsFor(TECHNIQUE_T1078)).find((c) => c.externalId === 'IDP')!;
    expect(assessed.assessment).toMatchObject({ strengthRung: 'L3', coverageBucket: 'L2' });
  });

  it('keeps a control the tenant removed visible, flagged removed', async () => {
    await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1078, 'prevent');

    const removed = (await controlsFor(TECHNIQUE_T1078))
      .find((c) => c.externalId === 'IDP' && c.function === 'prevent');
    expect(removed).toMatchObject({ source: 'catalogue', state: 'removed' });
  });

  it('shows a control the tenant added, flagged as a tenant addition', async () => {
    await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');

    const added = (await controlsFor(TECHNIQUE_T1005))
      .find((c) => c.externalId === 'IDP' && c.function === 'detect');
    expect(added).toMatchObject({ source: 'tenant', state: 'added' });
  });

  it('names the parent technique an inherited edge comes from, and never for a direct one', async () => {
    const controls = await controlsFor(TECHNIQUE_T1078_004);

    const inherited = controls.filter((c) => c.inheritedFrom !== null);
    expect(inherited.length).toBeGreaterThan(0);
    expect(inherited.every((c) => c.inheritedFrom!.externalId === 'T1078')).toBe(true);
    expect(controls.find((c) => c.externalId === 'CNAPP')!.inheritedFrom).toBeNull();
  });

  it('prefers the direct edge over the parent one, so a control is named once per function', async () => {
    const controls = await controlsFor(TECHNIQUE_T1078_004);

    const keys = controls.map((c) => `${c.externalId}:${c.function}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('answers nothing for a technique no control names', async () => {
    expect(await controlsFor(TECHNIQUE_T1583)).toEqual([]);
  });
});

describe('Techniques read from a tactic and from a mitigation', () => {
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    adminOrigin = (await createTenantWithAdmin(services)).origin;
  });

  it('a tactic answers with both grains, each carrying which one it is', async () => {
    const tactic = await services.withOrigin(adminOrigin).mitreAttack.getTacticByExternalId('TA0001');

    expect(tactic!.techniques.length).toBeGreaterThan(0);
    expect(tactic!.techniques.some((t) => t.isSubtechnique)).toBe(true);
    expect(tactic!.techniques.some((t) => !t.isSubtechnique)).toBe(true);
  });

  it('a tactic orders its techniques by external id, so a sub-technique follows its parent', async () => {
    const tactic = await services.withOrigin(adminOrigin).mitreAttack.getTacticByExternalId('TA0001');

    const ids = tactic!.techniques.map((t) => t.externalId);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('a mitigation answers with the grain of each technique it addresses', async () => {
    const mitigation = await services.withOrigin(adminOrigin).mitreAttack.getMitigationByExternalId('M1013');

    expect(mitigation!.techniques.length).toBeGreaterThan(0);
    expect(mitigation!.techniques.every((t) => typeof t.isSubtechnique === 'boolean')).toBe(true);
  });
});
