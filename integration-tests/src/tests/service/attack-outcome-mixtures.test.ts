import type { EventOrigin, MixturePair, ParsedThreatInput } from '@app/module';
import {
  AttackOutcome_DataBreachResale,
  attackOutcomesRepository,
  computeAttackerMixture,
  deriveSeedId,
  mixtureClockOf,
  mixtureFromRows,
  mixturePairKey,
} from '@app/module';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { DATA_BREACH_DESCRIPTION } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const recomputeActivityFor = async (tenantId: string): Promise<void> => {
  await services.withOrigin({ type: 'job', tenantId, jobKind: 'threat-activity-recompute', interactive: true })
    .threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
};

/** The description leads the outcome counter past 0.5 on Data Breach & Resale, so each group weighs on it. */
const buildGroup = (slug: string, options: { france?: boolean, defense?: boolean } = {}): ParsedThreatInput => {
  const provenance = { producerStixId: 'identity--test-producer', producerName: 'Test Producer', isInferred: false };
  const claimDates = { relCreated: null, relStartTime: null, relStopTime: null, relModified: null };
  return {
    threat: {
      stixId: `intrusion-set--${slug}`,
      entityType: 'intrusion-set',
      name: `${slug} group`,
      description: DATA_BREACH_DESCRIPTION,
      mitreGroupId: null,
      confidence: null,
      stixCreated: null,
      firstSeen: null,
      lastSeen: null,
      primaryMotivation: null,
      resourceLevel: null,
      sophistication: null,
      objective: null,
      labels: [],
    },
    aliases: [],
    secondaryMotivations: [],
    goals: [],
    threatActorTypes: [],
    roles: [],
    attributions: [],
    locations: options.france
      ? [{ ...provenance, ...claimDates, stixId: `location--${slug}-france`, stixRelationId: `relationship--${slug}-france`, name: 'France', country: 'France', relConfidence: 90 }]
      : [],
    sectors: options.defense
      ? [{ ...provenance, ...claimDates, stixId: `identity--${slug}-defense`, stixRelationId: `relationship--${slug}-defense`, name: 'Defense', relConfidence: 90 }]
      : [],
    cves: [],
    techniques: [
      { ...provenance, ...claimDates, stixId: `attack-pattern--${slug}-repo`, stixRelationId: `relationship--${slug}-repo`, name: 'Data from Information Repositories: Confluence', mitreExternalId: 'T1213.001', relConfidence: 80 },
      { ...provenance, ...claimDates, stixId: `attack-pattern--${slug}-scan`, stixRelationId: `relationship--${slug}-scan`, name: 'Active Scanning', mitreExternalId: 'T1595', relConfidence: 60 },
    ],
  };
};

describe('Attack outcome mixtures recompute', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;
  let franceId: string;
  let plainOrganizationId: string;
  let frenchOrganizationId: string;
  let plainScenarioId: string;
  let frenchScenarioId: string;

  const outcomeIdOf = (forTenantId: string) => deriveSeedId(forTenantId, AttackOutcome_DataBreachResale);

  const createOrganization = async (origin: EventOrigin, name: string, countryId?: string) => {
    const id = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id, name, countryId }]);
    return id;
  };

  const createScenario = async (origin: EventOrigin, forTenantId: string, organizationId: string, name: string) => {
    const id = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id,
      organizationId,
      name,
      description: null,
      attackOutcomeId: outcomeIdOf(forTenantId),
      primaryAssetIds: [],
    });
    return id;
  };

  const ingestThreats = async (origin: EventOrigin, forTenantId: string) => {
    await services.withOrigin(origin).threatAnalyses
      .ingestBundle([buildGroup('alpha'), buildGroup('beta'), buildGroup('gamma', { france: true })], forTenantId, 'stix-import');
    await recomputeActivityFor(forTenantId);
  };

  const storedFor = async (origin: EventOrigin, forTenantId: string, pairs: Array<MixturePair>) =>
    attackOutcomesRepository.findStoredMixtures(repositoryContextOf(db, origin), forTenantId, pairs);

  /** The writing transaction of each stored row of a tenant: a row left alone keeps its `xmin`. */
  const rowVersions = async (forTenantId: string): Promise<Array<string>> => {
    const parents = await db.execute<{ version: string }>(
      sql`select organization_id::text || '/' || attack_outcome_id::text || ':' || xmin::text as version from attack_outcome_mixtures where tenant_id = ${forTenantId}`,
    );
    const groups = await db.execute<{ version: string }>(
      sql`select organization_id::text || '/' || attack_outcome_id::text || '/' || group_key || ':' || xmin::text as version from attack_outcome_mixture_groups where tenant_id = ${forTenantId}`,
    );
    return [...parents.rows, ...groups.rows].map((row) => row.version).toSorted();
  };

  const countRows = async (forTenantId: string): Promise<{ mixtures: number, groups: number }> => {
    const mixtures = await db.execute<{ count: string }>(sql`select count(*) from attack_outcome_mixtures where tenant_id = ${forTenantId}`);
    const groups = await db.execute<{ count: string }>(sql`select count(*) from attack_outcome_mixture_groups where tenant_id = ${forTenantId}`);
    return { mixtures: Number(mixtures.rows[0].count), groups: Number(groups.rows[0].count) };
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    franceId = countries.find((country) => country.name === 'France')!.id;
    plainOrganizationId = await createOrganization(adminOrigin, 'Plain Organization');
    frenchOrganizationId = await createOrganization(adminOrigin, 'French Organization', franceId);
    plainScenarioId = await createScenario(adminOrigin, tenantId, plainOrganizationId, 'Plain scenario');
    frenchScenarioId = await createScenario(adminOrigin, tenantId, frenchOrganizationId, 'French scenario');
  });

  it('should refuse to run outside a job origin', async () => {
    await expect(services.withOrigin(adminOrigin).attackOutcomes.recomputeAttackOutcomeMixtures()).rejects.toThrow();
  });

  it('should store exactly the mixture the existing evidence read and weighting compute', async () => {
    const defenseId = (await services.withOrigin(adminOrigin).sectors.getSectors()).find((sector) => sector.name === 'Defense')!.id;
    await services.withOrigin(adminOrigin).organizations.updateOrganization(plainOrganizationId, { sectorId: defenseId });
    await services.withOrigin(adminOrigin).threatAnalyses
      .ingestBundle([buildGroup('alpha'), buildGroup('beta'), buildGroup('gamma', { france: true }), buildGroup('delta', { defense: true })], tenantId, 'stix-import');
    await recomputeActivityFor(tenantId);

    const result = await recomputeAttackOutcomeMixtures(services, tenantId);
    expect(result).toEqual({ written: 2, removed: 0, unchanged: 0 });

    const attackOutcomeId = outcomeIdOf(tenantId);
    const settings = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings(tenantId);
    const live = async (countryIds: Array<string>, sectorIds: Array<string>) => {
      const [evidence] = await services.withOrigin(adminOrigin).threatAnalyses
        .getAttackerMixtureEvidenceByProfile({ attackOutcomeIds: [attackOutcomeId], profiles: [{ countryIds, sectorIds }], tenantId });
      return computeAttackerMixture({
        groups: evidence.get(attackOutcomeId)!.groups,
        now: mixtureClockOf(new Date()),
        halfLifeObservedDays: settings.actHalfLifeObservedDays,
        halfLifeAuthoredDays: settings.actHalfLifeAuthoredDays,
      });
    };
    const plainPair = { organizationId: plainOrganizationId, attackOutcomeId };
    const frenchPair = { organizationId: frenchOrganizationId, attackOutcomeId };
    const stored = await storedFor(adminOrigin, tenantId, [plainPair, frenchPair]);

    const plainLive = await live([], [defenseId]);
    const frenchLive = await live([franceId], []);
    expect(plainLive).not.toEqual(await live([], []));
    expect(plainLive.groups.length).toBeGreaterThan(1);
    expect(frenchLive.groups.length).toBeGreaterThan(1);
    expect(mixtureFromRows(stored.get(mixturePairKey(plainPair))!)).toEqual(plainLive);
    expect(mixtureFromRows(stored.get(mixturePairKey(frenchPair))!)).toEqual(frenchLive);
  });

  it('should decay the actors against the day it is given rather than today', async () => {
    await ingestThreats(adminOrigin, tenantId);
    const at = new Date('2026-01-15T10:00:00Z');

    await recomputeAttackOutcomeMixtures(services, tenantId, { at });

    const attackOutcomeId = outcomeIdOf(tenantId);
    const pair = { organizationId: plainOrganizationId, attackOutcomeId };
    const settings = await services.withOrigin(adminOrigin).threatRelevanceSettings.getThreatRelevanceSettings(tenantId);
    const [evidence] = await services.withOrigin(adminOrigin).threatAnalyses
      .getAttackerMixtureEvidenceByProfile({ attackOutcomeIds: [attackOutcomeId], profiles: [{ countryIds: [], sectorIds: [] }], tenantId });
    const stored = (await storedFor(adminOrigin, tenantId, [pair])).get(mixturePairKey(pair))!;
    expect(stored.mixture.computedAt).toEqual(mixtureClockOf(at));
    expect(mixtureFromRows(stored)).toEqual(computeAttackerMixture({
      groups: evidence.get(attackOutcomeId)!.groups,
      now: mixtureClockOf(at),
      halfLifeObservedDays: settings.actHalfLifeObservedDays,
      halfLifeAuthoredDays: settings.actHalfLifeAuthoredDays,
    }));
  });

  it('should rewrite nothing on a second run over unchanged inputs', async () => {
    await ingestThreats(adminOrigin, tenantId);
    await recomputeAttackOutcomeMixtures(services, tenantId);
    const before = await rowVersions(tenantId);
    expect(before.length).toBeGreaterThan(2);

    const result = await recomputeAttackOutcomeMixtures(services, tenantId);

    expect(result).toEqual({ written: 0, removed: 0, unchanged: 2 });
    expect(await rowVersions(tenantId)).toEqual(before);
  });

  it('should delete the rows of a pair when its last scenario is deleted', async () => {
    await ingestThreats(adminOrigin, tenantId);
    await recomputeAttackOutcomeMixtures(services, tenantId);
    const attackOutcomeId = outcomeIdOf(tenantId);

    await services.withOrigin(adminOrigin).riskScenarios.deleteRiskScenarios([frenchScenarioId]);
    const result = await recomputeAttackOutcomeMixtures(services, tenantId);

    expect(result).toEqual({ written: 0, removed: 1, unchanged: 1 });
    const stored = await storedFor(adminOrigin, tenantId, [
      { organizationId: plainOrganizationId, attackOutcomeId },
      { organizationId: frenchOrganizationId, attackOutcomeId },
    ]);
    expect([...stored.keys()]).toEqual([mixturePairKey({ organizationId: plainOrganizationId, attackOutcomeId })]);
    const remaining = await countRows(tenantId);
    expect(remaining.mixtures).toBe(1);
    expect(remaining.groups).toBe(stored.get(mixturePairKey({ organizationId: plainOrganizationId, attackOutcomeId }))!.groups.length);
  });

  it('should delete the rows of an organization with the organization', async () => {
    await ingestThreats(adminOrigin, tenantId);
    await recomputeAttackOutcomeMixtures(services, tenantId);
    expect((await countRows(tenantId)).mixtures).toBe(2);

    // No job run between the two deletes: the stored rows go with the organization, not with a recompute.
    await services.withOrigin(adminOrigin).riskScenarios.deleteRiskScenarios([frenchScenarioId]);
    await services.withOrigin(adminOrigin).organizations.deleteOrganizations([frenchOrganizationId]);

    const remaining = await countRows(tenantId);
    expect(remaining.mixtures).toBe(1);
    const attackOutcomeId = outcomeIdOf(tenantId);
    const stored = await storedFor(adminOrigin, tenantId, [{ organizationId: plainOrganizationId, attackOutcomeId }]);
    expect(remaining.groups).toBe(stored.get(mixturePairKey({ organizationId: plainOrganizationId, attackOutcomeId }))!.groups.length);
  });

  it('should neither write nor delete anything in another tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
    const otherOrganizationId = await createOrganization(otherOrigin, 'Other Organization');
    await createScenario(otherOrigin, otherTenantId, otherOrganizationId, 'Other scenario');
    await ingestThreats(adminOrigin, tenantId);
    await ingestThreats(otherOrigin, otherTenantId);
    await recomputeAttackOutcomeMixtures(services, otherTenantId);
    const otherBefore = await rowVersions(otherTenantId);
    expect(otherBefore.length).toBeGreaterThan(1);

    expect(await recomputeAttackOutcomeMixtures(services, tenantId)).toEqual({ written: 2, removed: 0, unchanged: 0 });
    expect(await rowVersions(otherTenantId)).toEqual(otherBefore);

    await services.withOrigin(adminOrigin).riskScenarios.deleteRiskScenarios([plainScenarioId, frenchScenarioId]);
    expect(await recomputeAttackOutcomeMixtures(services, tenantId)).toEqual({ written: 0, removed: 2, unchanged: 0 });
    expect(await countRows(tenantId)).toEqual({ mixtures: 0, groups: 0 });
    expect(await rowVersions(otherTenantId)).toEqual(otherBefore);
  });

  it('should store a parent row with no group for an organization no actor is admitted for', async () => {
    const result = await recomputeAttackOutcomeMixtures(services, tenantId);
    expect(result).toEqual({ written: 2, removed: 0, unchanged: 0 });

    const attackOutcomeId = outcomeIdOf(tenantId);
    const stored = await storedFor(adminOrigin, tenantId, [{ organizationId: plainOrganizationId, attackOutcomeId }]);
    const rows = stored.get(mixturePairKey({ organizationId: plainOrganizationId, attackOutcomeId }))!;
    expect(rows.groups).toEqual([]);
    expect(mixtureFromRows(rows)).toEqual(computeAttackerMixture({ groups: [], now: mixtureClockOf(new Date()) }));
    expect(await countRows(tenantId)).toEqual({ mixtures: 2, groups: 0 });
  });
});
