import type { ConnectorAssetInput, EventOrigin, ParsedThreatInput } from '@app/module';
import { assetEvidence, Capability_ManageSecurity, MarkingDefinitionNotFoundError, ProtectedMarkingDefinitionError, riskScenarios, TECHNIQUE_T1003 } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantUser, createTenantWithAdmin, createUser, grantCapability } from '../../helpers/factories';
import { buildParsedEntry, DEFAULT_LIST_PARAMS } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';

const threat = (stixId: string, name: string, markingRefs: Array<string>): ParsedThreatInput => {
  const entry = buildParsedEntry('initial');
  return { ...entry, threat: { ...entry.threat, stixId, name, mitreGroupId: null, markingRefs } };
};

/**
 * Deleting a marking declassifies every object that carries it, as OpenAEV does, rather than leaving
 * them hidden from everyone for a marking no clearance can name again. A default TLP marking cannot
 * be deleted, and a marking the caller is not cleared for answers not found.
 */
describe('Marking definition deletion', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let superAdminOrigin: EventOrigin;
  let memberOrigin: EventOrigin;
  let managerOrigin: EventOrigin;
  let managerId: string;
  let marking: { id: string, stixId: string };
  let assetId: string;
  let scenarioId: string;

  const carriers = async (stixId: string) => {
    const count = async (table: string, column: string, extra = sql``) => Number((await db.execute(sql`select count(*) as n from ${sql.raw(table)} where ${sql.raw(column)} @> array[${stixId}]::text[] ${extra}`)).rows[0].n);
    return {
      assets: await count('supporting_assets', 'marking_refs'),
      sources: await count('supporting_asset_sources', 'reported_marking_refs'),
      evidence: await count('asset_evidence', 'marking_refs'),
      scenarios: await count('risk_scenarios', 'marking_refs'),
      importedThreats: await count('threat_analyses', 'marking_refs', sql`and kind <> 'connector'`),
      connectorThreats: await count('threat_analyses', 'marking_refs', sql`and kind = 'connector'`),
    };
  };

  const deletion = (origin: EventOrigin, id = marking.id) => services.withOrigin(origin).markingDefinitions.deleteMarkingDefinition(id);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    const superAdminId = (await createUser(db)).userId;
    await db.execute(sql`UPDATE users SET is_super_admin = true WHERE id = ${superAdminId}`);
    superAdminOrigin = { type: 'client', userId: superAdminId, tenantId };
    memberOrigin = (await createTenantUser(services, db, adminOrigin)).origin;
    const manager = await createTenantUser(services, db, adminOrigin);
    managerId = manager.userId;
    managerOrigin = manager.origin;
    await grantCapability(services, adminOrigin, managerId, Capability_ManageSecurity);

    const created = await services.withOrigin(adminOrigin).markingDefinitions.createMarkingDefinition({ definitionType: 'CUSTOM', definition: 'CUSTOM:SECRET' });
    marking = { id: created.id, stixId: created.stixId };

    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      threat('intrusion-set--88888888-8888-4888-8888-888888888881', 'Imported Actor', [marking.stixId]),
    ], tenantId, 'stix-import');
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      threat('intrusion-set--88888888-8888-4888-8888-888888888882', 'Mirrored Actor', [marking.stixId]),
    ], tenantId, 'connector');

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test OpenAEV Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
    const asset: ConnectorAssetInput = {
      sourceAssetId: 'oaev-secret', categoryId: 'host', connectorId, source: 'openaev', name: 'srv-secret', markingRefs: [marking.stixId],
      properties: { family: 'machine', hostname: 'srv-secret.corp.example' },
    };
    assetId = (await services.withOrigin({ type: 'connector', serviceAccountId, tenantId }).supportingAssets.bulkUpsertAssets([asset])).get('oaev-secret')!;
    await db.insert(assetEvidence).values([{
      id: uuidv7(), supportingAssetId: assetId, tenantId, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'prevention', evaluatedAt: new Date(), markingRefs: [marking.stixId],
    }]);

    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Test Organization' }]);
    scenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: scenarioId, organizationId, name: 'Secret Scenario', description: null,
      attackOutcomeId: (await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes())[0].id, primaryAssetIds: [],
    });
    await db.update(riskScenarios).set({ markingRefs: [marking.stixId] }).where(eq(riskScenarios.id, scenarioId));
  });

  it('should declassify what carries the marking, so a member with no clearance reads it', async () => {
    const member = services.withOrigin(memberOrigin);
    expect(await member.supportingAssets.getSupportingAsset(assetId)).toBeNull();
    expect(await member.riskScenarios.getRiskScenario(scenarioId)).toBeUndefined();
    expect((await member.threatAnalyses.list(DEFAULT_LIST_PARAMS)).items.map((item) => item.name)).not.toContain('Imported Actor');

    await deletion(superAdminOrigin);

    expect(await member.supportingAssets.getSupportingAsset(assetId)).not.toBeNull();
    expect(await member.riskScenarios.getRiskScenario(scenarioId)).toBeDefined();
    expect((await member.threatAnalyses.list(DEFAULT_LIST_PARAMS)).items.map((item) => item.name)).toContain('Imported Actor');
    expect(await carriers(marking.stixId)).toMatchObject({ assets: 0, sources: 0, evidence: 0, scenarios: 0, importedThreats: 0 });
    expect((await services.withOrigin(adminOrigin).markingDefinitions.listMarkingDefinitions()).map((candidate) => candidate.id)).not.toContain(marking.id);
  });

  it('should keep the marking on a threat mirrored from OpenCTI, which follows OpenCTI\'s markings', async () => {
    await deletion(superAdminOrigin);

    expect((await carriers(marking.stixId)).connectorThreats).toBe(1);
  });

  it('should refuse to delete a default marking', async () => {
    const scoped = services.withOrigin(superAdminOrigin).markingDefinitions;
    const red = (await scoped.listMarkingDefinitions()).find((candidate) => candidate.stixId === TLP_RED)!;

    await expect(deletion(superAdminOrigin, red.id)).rejects.toBeInstanceOf(ProtectedMarkingDefinitionError);

    expect((await scoped.listMarkingDefinitions()).map((candidate) => candidate.stixId)).toContain(TLP_RED);
  });

  it('should answer not found, and declassify nothing, to a security manager who is not cleared for the marking', async () => {
    await expect(deletion(managerOrigin)).rejects.toBeInstanceOf(MarkingDefinitionNotFoundError);

    expect(await carriers(marking.stixId)).toMatchObject({ assets: 1, sources: 1, evidence: 1, scenarios: 1, importedThreats: 1 });
  });

  it('should refuse, and declassify nothing, to a member cleared for the marking who cannot manage security', async () => {
    const scoped = services.withOrigin(adminOrigin);
    const groupId = uuidv7();
    await scoped.groups.createGroup({ id: groupId, name: 'Secret holders' });
    await scoped.groups.addUserToGroup(groupId, memberOrigin.type === 'client' ? memberOrigin.userId : '');
    await scoped.markingDefinitions.addMarkingToGroup(groupId, marking.id);

    await expect(deletion(memberOrigin)).rejects.toThrow('Access Denied');

    expect(await carriers(marking.stixId)).toMatchObject({ assets: 1, sources: 1, evidence: 1, scenarios: 1, importedThreats: 1 });
    expect((await scoped.markingDefinitions.listMarkingDefinitions()).map((candidate) => candidate.id)).toContain(marking.id);
  });

  it('should let a security manager delete a marking once they are cleared for it', async () => {
    const scoped = services.withOrigin(adminOrigin);
    const groupId = uuidv7();
    await scoped.groups.createGroup({ id: groupId, name: 'Secret holders' });
    await scoped.groups.addUserToGroup(groupId, managerId);
    await scoped.markingDefinitions.addMarkingToGroup(groupId, marking.id);

    await deletion(managerOrigin);

    expect(await carriers(marking.stixId)).toMatchObject({ assets: 0, sources: 0, evidence: 0, scenarios: 0, importedThreats: 0 });
  });

  it('should answer not found for the marking of another tenant', async () => {
    const other = await createTenantWithAdmin(services);
    const foreign = await services.withOrigin(other.origin).markingDefinitions.createMarkingDefinition({ definitionType: 'CUSTOM', definition: 'CUSTOM:FOREIGN' });

    await expect(deletion(superAdminOrigin, foreign.id)).rejects.toBeInstanceOf(MarkingDefinitionNotFoundError);
  });
});
