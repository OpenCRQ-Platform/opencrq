import type { EventOrigin } from '@app/module';
import {
  activityGradeFor,
  AttackOutcome_FinancialFraudFundsTheft,
  deriveSeedId,
  parseThreatBundle,
  threatAnalyses,
  threatAnalysisAttributions,
  threatAnalysisLocations,
  threatAnalysisOutcomeProbabilities,
  threatAnalysisRoles,
  threatAnalysisSectors,
  threatAnalysisTechniques,
  threatAnalysisThreatActorTypes,
} from '@app/module';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { FRAUD_DESCRIPTION, readStoredProbability } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const THREAT_ACTOR = 'threat-actor--aaaaaaaa-0000-4000-8000-000000000001';
const CAMPAIGN = 'campaign--aaaaaaaa-0000-4000-8000-000000000002';
const INTRUSION_SET = 'intrusion-set--aaaaaaaa-0000-4000-8000-000000000003';

const technique = (externalId: string, name: string) => ({
  type: 'attack-pattern',
  id: `attack-pattern--${externalId.toLowerCase()}`,
  name,
  external_references: [{ source_name: 'mitre-attack', external_id: externalId }],
});

const relationship = (id: string, relationshipType: string, sourceRef: string, targetRef: string) => ({
  type: 'relationship',
  id: `relationship--${id}`,
  relationship_type: relationshipType,
  source_ref: sourceRef,
  target_ref: targetRef,
  confidence: 80,
});

const REFERENCE_OBJECTS = [
  { type: 'location', id: 'location--france', name: 'France', country: 'France' },
  { type: 'identity', id: 'identity--finance', name: 'Finance', identity_class: 'class' },
  { type: 'vulnerability', id: 'vulnerability--cve-2024-3400', name: 'CVE-2024-3400' },
  { type: 'malware', id: 'malware--lure', name: 'Lure Loader' },
  technique('T1566', 'Phishing'),
  technique('T1657', 'Financial Theft'),
  technique('T1111', 'Multi-Factor Authentication Interception'),
  technique('T1098', 'Account Manipulation'),
];

// Distinct names and aliases: the attacker mixture folds actors sharing either.
const THREAT_ACTOR_OBJECTS = [
  {
    type: 'threat-actor',
    id: THREAT_ACTOR,
    name: 'Kraken Test Syndicate',
    confidence: 80,
    sophistication: 'expert',
    threat_actor_types: ['crime-syndicate'],
    roles: ['sponsor'],
    primary_motivation: 'personal-gain',
    secondary_motivations: ['notoriety'],
    goals: ['steal payments'],
  },
  relationship('ta-france', 'targets', THREAT_ACTOR, 'location--france'),
  relationship('ta-finance', 'targets', THREAT_ACTOR, 'identity--finance'),
  relationship('ta-cve', 'targets', THREAT_ACTOR, 'vulnerability--cve-2024-3400'),
  relationship('ta-t1566', 'uses', THREAT_ACTOR, 'attack-pattern--t1566'),
  relationship('ta-t1657', 'uses', THREAT_ACTOR, 'attack-pattern--t1657'),
  relationship('ta-malware', 'uses', THREAT_ACTOR, 'malware--lure'),
  relationship('ta-origin', 'originates-from', THREAT_ACTOR, 'location--france'),
];

const CAMPAIGN_OBJECTS = [
  {
    type: 'campaign',
    id: CAMPAIGN,
    name: 'Operation Test Ledger',
    confidence: 80,
    objective: 'Divert outgoing payments',
    description: FRAUD_DESCRIPTION,
    first_seen: '2026-07-01T00:00:00.000Z',
    last_seen: '2026-07-31T00:00:00.000Z',
  },
  relationship('c-finance', 'targets', CAMPAIGN, 'identity--finance'),
  relationship('c-t1111', 'uses', CAMPAIGN, 'attack-pattern--t1111'),
  relationship('c-is', 'attributed-to', CAMPAIGN, INTRUSION_SET),
];

const INTRUSION_SET_OBJECTS = [
  { type: 'intrusion-set', id: INTRUSION_SET, name: 'Group Gamma Test', aliases: ['Gamma Test'], labels: ['ransomware'], confidence: 80 },
  relationship('is-t1098', 'uses', INTRUSION_SET, 'attack-pattern--t1098'),
  relationship('is-ta', 'attributed-to', INTRUSION_SET, THREAT_ACTOR),
];

const bundleOf = (...objects: Array<Array<Record<string, unknown>>>) => ({
  type: 'bundle',
  id: 'bundle--aaaaaaaa-0000-4000-8000-0000000000ff',
  objects: [...REFERENCE_OBJECTS, ...objects.flat()],
});

describe('Threat actors and campaigns from STIX bundles', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  const otherTenant = async (): Promise<{ tenantId: string, origin: EventOrigin }> => {
    const otherTenantId = await createTenant(services, adminUserId);
    return { tenantId: otherTenantId, origin: { type: 'client', userId: adminUserId, tenantId: otherTenantId } };
  };

  const upload = async (...objects: Array<Array<Record<string, unknown>>>) =>
    services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(parseThreatBundle(bundleOf(...objects)), tenantId, 'stix-import');

  const threatRow = async (stixId: string) =>
    (await db.select().from(threatAnalyses).where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, stixId)))).at(0);

  const threatId = async (stixId: string): Promise<string> => {
    const row = await threatRow(stixId);
    if (!row) {
      throw new Error(`No threat for ${stixId}`);
    }
    return row.id;
  };

  const values = async (table: typeof threatAnalysisRoles | typeof threatAnalysisThreatActorTypes, analysisId: string) =>
    (await db.select({ value: table.value }).from(table).where(eq(table.analysisId, analysisId))).map((row) => row.value);

  const finance = async () => (await services.withOrigin(adminOrigin).sectors.getSectors()).find((sector) => sector.name === 'Finance')!;

  describe('import', () => {
    it('should store a threat actor with its targets and techniques', async () => {
      await upload(THREAT_ACTOR_OBJECTS);

      const actor = await threatRow(THREAT_ACTOR);
      expect(actor?.entityType).toBe('threat-actor');
      const locations = await db.select().from(threatAnalysisLocations).where(eq(threatAnalysisLocations.analysisId, actor!.id));
      const sectors = await db.select().from(threatAnalysisSectors).where(eq(threatAnalysisSectors.analysisId, actor!.id));
      const techniques = await db.select().from(threatAnalysisTechniques).where(eq(threatAnalysisTechniques.analysisId, actor!.id));
      expect(locations.map((row) => row.country)).toEqual(['France']);
      expect(sectors.map((row) => row.name)).toEqual(['Finance']);
      expect(techniques.map((row) => row.mitreExternalId).sort()).toEqual(['T1566', 'T1657']);
    });

    it('should store the sophistication, types and roles a threat actor states', async () => {
      await upload(THREAT_ACTOR_OBJECTS);

      const actor = await threatRow(THREAT_ACTOR);
      expect(actor?.sophistication).toBe('expert');
      expect(await values(threatAnalysisThreatActorTypes, actor!.id)).toEqual(['crime-syndicate']);
      expect(await values(threatAnalysisRoles, actor!.id)).toEqual(['sponsor']);
    });

    it('should store a campaign with its dates, objective and targeted sector', async () => {
      await upload(CAMPAIGN_OBJECTS);

      const campaign = await threatRow(CAMPAIGN);
      expect(campaign).toMatchObject({
        entityType: 'campaign',
        objective: 'Divert outgoing payments',
        firstSeen: new Date('2026-07-01T00:00:00.000Z'),
        lastSeen: new Date('2026-07-31T00:00:00.000Z'),
      });
      const sectors = await db.select().from(threatAnalysisSectors).where(eq(threatAnalysisSectors.analysisId, campaign!.id));
      expect(sectors.map((row) => row.name)).toEqual(['Finance']);
    });

    it('should show a campaign\'s first and last seen dates on its detail', async () => {
      await upload(CAMPAIGN_OBJECTS);

      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(await threatId(CAMPAIGN));
      expect(detail?.analysis.firstSeen).toEqual(new Date('2026-07-01T00:00:00.000Z'));
      expect(detail?.analysis.lastSeen).toEqual(new Date('2026-07-31T00:00:00.000Z'));
    });

    it('should give a campaign the default class, whatever the class of the threat it is attributed to', async () => {
      await upload(INTRUSION_SET_OBJECTS, CAMPAIGN_OBJECTS);

      expect((await threatRow(INTRUSION_SET))?.actorClass).toBe('ransomware_operator');
      expect((await threatRow(CAMPAIGN))?.actorClass).toBe('default');
    });

    it('should keep one threat per STIX id when the same bundle is uploaded again', async () => {
      await upload(THREAT_ACTOR_OBJECTS, CAMPAIGN_OBJECTS);
      const firstIds = [await threatId(THREAT_ACTOR), await threatId(CAMPAIGN)];

      const outcome = await upload(THREAT_ACTOR_OBJECTS, CAMPAIGN_OBJECTS);

      expect(outcome).toEqual({ created: 0, updated: 0, unchanged: 2, skipped: 0 });
      expect([await threatId(THREAT_ACTOR), await threatId(CAMPAIGN)]).toEqual(firstIds);
      expect(await db.select().from(threatAnalyses).where(eq(threatAnalyses.tenantId, tenantId))).toHaveLength(2);
    });

    it('should ignore a uses toward a malware and an originates-from toward a country', async () => {
      await upload(THREAT_ACTOR_OBJECTS);

      const actorId = await threatId(THREAT_ACTOR);
      const locations = await db.select().from(threatAnalysisLocations).where(eq(threatAnalysisLocations.analysisId, actorId));
      const techniques = await db.select().from(threatAnalysisTechniques).where(eq(threatAnalysisTechniques.analysisId, actorId));
      expect(locations.map((row) => row.stixRelationId)).toEqual(['relationship--ta-france']);
      expect(techniques.map((row) => row.stixRelationId)).not.toContain('relationship--ta-malware');
    });
  });

  describe('scenarios', () => {
    it('should list a threat actor and a campaign among the relevant threats of an organization in their sector', async () => {
      await upload(THREAT_ACTOR_OBJECTS, CAMPAIGN_OBJECTS);
      expect(await readStoredProbability(db, CAMPAIGN, deriveSeedId(tenantId, AttackOutcome_FinancialFraudFundsTheft))).toBeGreaterThan(0.5);

      const { items } = await services.withOrigin(adminOrigin).threatAnalyses.getRelevantForScenario({
        attackOutcomeId: deriveSeedId(tenantId, AttackOutcome_FinancialFraudFundsTheft),
        countryIds: [],
        sectorIds: [(await finance()).id],
      });

      expect(items.map((item) => [item.name, item.entityType]).sort()).toEqual([
        ['Kraken Test Syndicate', 'threat-actor'],
        ['Operation Test Ledger', 'campaign'],
      ]);
    });

    it('should make a threat actor one of the actor groups a CRQ run reads', async () => {
      await upload(THREAT_ACTOR_OBJECTS, CAMPAIGN_OBJECTS);
      const outcomeId = deriveSeedId(tenantId, AttackOutcome_FinancialFraudFundsTheft);

      const [evidence] = await services.withOrigin(adminOrigin).threatAnalyses.getAttackerMixtureEvidenceByProfile({
        attackOutcomeIds: [outcomeId],
        profiles: [{ countryIds: [], sectorIds: [(await finance()).id] }],
      });

      const groups = evidence.get(outcomeId)!.groups;
      expect(groups.map((group) => [group.groupKey, group.entityType])).toEqual(expect.arrayContaining([
        [await threatId(THREAT_ACTOR), 'threat-actor'],
        [await threatId(CAMPAIGN), 'campaign'],
      ]));
    });

    it('should give a threat actor and a campaign a computed activity, a list row and stored outcome probabilities', async () => {
      await upload(THREAT_ACTOR_OBJECTS, CAMPAIGN_OBJECTS);
      const job = (jobKind: string): EventOrigin => ({ type: 'job', tenantId, jobKind, interactive: false });

      await services.withOrigin(job('threat-activity-recompute')).threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
      await services.withOrigin(job('threat-list-projection-recompute')).threatAnalyses.recomputeListProjections();

      const actorId = await threatId(THREAT_ACTOR);
      const { items, pending } = await services.withOrigin(adminOrigin).threatAnalyses.list({ page: 1, limit: 50, sortDesc: true });
      expect(pending).toBe(0);
      expect(items.map((item) => [item.name, item.entityType]).sort()).toEqual([
        ['Kraken Test Syndicate', 'threat-actor'],
        ['Operation Test Ledger', 'campaign'],
      ]);
      expect((await threatRow(THREAT_ACTOR))?.activityComputedAt).not.toBeNull();
      expect((await threatRow(CAMPAIGN))?.activityComputedAt).not.toBeNull();
      expect(await db.select().from(threatAnalysisOutcomeProbabilities).where(eq(threatAnalysisOutcomeProbabilities.analysisId, actorId))).not.toHaveLength(0);
    });
  });

  describe('attributions', () => {
    it('should show an intrusion set attributed to a threat actor on both details', async () => {
      await upload(THREAT_ACTOR_OBJECTS, INTRUSION_SET_OBJECTS);
      const scoped = services.withOrigin(adminOrigin).threatAnalyses;

      const intrusionSet = await scoped.getDetail(await threatId(INTRUSION_SET));
      const actor = await scoped.getDetail(await threatId(THREAT_ACTOR));

      expect(intrusionSet?.attributedTo).toEqual([{ id: await threatId(THREAT_ACTOR), name: 'Kraken Test Syndicate', entityType: 'threat-actor' }]);
      expect(actor?.attributedFrom).toEqual([{ id: await threatId(INTRUSION_SET), name: 'Group Gamma Test', entityType: 'intrusion-set' }]);
    });

    it('should show an attribution toward a threat actor that arrives after the intrusion set', async () => {
      await upload(INTRUSION_SET_OBJECTS);
      const scoped = services.withOrigin(adminOrigin).threatAnalyses;
      expect((await scoped.getDetail(await threatId(INTRUSION_SET)))?.attributedTo).toEqual([]);

      await upload(THREAT_ACTOR_OBJECTS);

      expect((await scoped.getDetail(await threatId(INTRUSION_SET)))?.attributedTo.map((threat) => threat.name)).toEqual(['Kraken Test Syndicate']);
      expect((await scoped.getDetail(await threatId(THREAT_ACTOR)))?.attributedFrom.map((threat) => threat.name)).toEqual(['Group Gamma Test']);
    });

    it('should drop the attribution of a removed threat actor and leave the intrusion set untouched', async () => {
      await upload(THREAT_ACTOR_OBJECTS, INTRUSION_SET_OBJECTS);
      const intrusionSetBefore = await threatRow(INTRUSION_SET);

      await services.withOrigin(adminOrigin).threatAnalyses.retractActors(tenantId, 'stix-import', [THREAT_ACTOR]);

      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(intrusionSetBefore!.id);
      expect(detail?.attributedTo).toEqual([]);
      expect(await threatRow(INTRUSION_SET)).toEqual(intrusionSetBefore);
      expect(await db.select().from(threatAnalysisAttributions).where(eq(threatAnalysisAttributions.analysisId, intrusionSetBefore!.id))).toHaveLength(1);
    });
  });

  describe('activity through attribution', () => {
    const OPENCTI_EXTENSION = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';
    const job: EventOrigin = { type: 'job', tenantId: '', jobKind: 'threat-activity-recompute', interactive: false };
    const stixId = (type: string, suffix: number) => `${type}--bbbbbbbb-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
    const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

    const threat = (id: string, name: string, lastSeen: string | null = null): Record<string, unknown> => ({
      type: id.split('--')[0],
      id,
      name,
      confidence: 80,
      ...(lastSeen === null ? {} : { last_seen: lastSeen }),
    });

    const attributedTo = (id: string, source: string, target: string, extra: Record<string, unknown> = {}) =>
      ({ ...relationship(id, 'attributed-to', source, target), ...extra });

    const recompute = async (isDailyBooking = false) =>
      services.withOrigin({ ...job, tenantId }).threatActivity.recomputeActivity({ now: new Date(), isDailyBooking });

    const activityOf = async (id: string) => {
      const row = await threatRow(id);
      return { lastObservedAt: row?.lastObservedAt };
    };

    const setGate = async (confidenceGate: number) => {
      const scoped = services.withOrigin(adminOrigin).threatRelevanceSettings;
      await scoped.updateThreatRelevanceSettings({ ...await scoped.getThreatRelevanceSettings(), confidenceGate });
    };

    const CAMPAIGN_ID = stixId('campaign', 1);
    const SET_ID = stixId('intrusion-set', 2);
    const ACTOR_ID = stixId('threat-actor', 3);

    it('should date an undated intrusion set by the campaign attributed to it', async () => {
      const seen = daysAgo(10);
      await upload([threat(CAMPAIGN_ID, 'Dated campaign', seen), threat(SET_ID, 'Undated set'), attributedTo('c-set', CAMPAIGN_ID, SET_ID)]);

      await recompute();

      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: new Date(seen) });
    });

    it('should date a threat actor through the intrusion set the campaign is attributed to', async () => {
      const seen = daysAgo(10);
      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', seen),
        threat(SET_ID, 'Undated set'),
        threat(ACTOR_ID, 'Undated actor'),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID),
        attributedTo('set-ta', SET_ID, ACTOR_ID),
      ]);

      await recompute();

      expect(await activityOf(ACTOR_ID)).toEqual({ lastObservedAt: new Date(seen) });
    });

    it('should name the campaign as the source of the date of its intrusion set, and no source for a threat dated by itself', async () => {
      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', daysAgo(10)),
        threat(SET_ID, 'Undated set'),
        threat(ACTOR_ID, 'Active actor', daysAgo(5)),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID),
        attributedTo('set-ta', SET_ID, ACTOR_ID),
      ]);

      await recompute();

      expect((await threatRow(SET_ID))?.lastObservedViaAnalysisId).toBe((await threatRow(CAMPAIGN_ID))?.id);
      expect((await threatRow(CAMPAIGN_ID))?.lastObservedViaAnalysisId).toBeNull();
      expect((await threatRow(ACTOR_ID))?.lastObservedViaAnalysisId).toBeNull();
    });

    it('should expose the source of the date on the detail, and none for a threat dated by itself', async () => {
      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', daysAgo(10)),
        threat(SET_ID, 'Undated set'),
        threat(ACTOR_ID, 'Active actor', daysAgo(5)),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID),
        attributedTo('set-ta', SET_ID, ACTOR_ID),
      ]);
      await recompute();
      const analyses = services.withOrigin(adminOrigin).threatAnalyses;

      const setDetail = await analyses.getDetail(await threatId(SET_ID));
      const actorDetail = await analyses.getDetail(await threatId(ACTOR_ID));

      expect(setDetail?.activity.lastObservedVia).toEqual({ id: await threatId(CAMPAIGN_ID), name: 'Dated campaign' });
      expect(actorDetail?.activity.lastObservedVia).toBeNull();
    });

    it('should expose no source once the threat that supplied the date is gone', async () => {
      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', daysAgo(10)),
        threat(SET_ID, 'Undated set'),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID),
      ]);
      await recompute();
      await db.delete(threatAnalyses).where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, CAMPAIGN_ID)));

      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(await threatId(SET_ID));

      expect(detail?.activity.lastObservedVia).toBeNull();
    });

    it('should not let a recently active threat actor date what is attributed to it', async () => {
      const actorSeen = daysAgo(5);
      await upload([
        threat(CAMPAIGN_ID, 'Undated campaign'),
        threat(SET_ID, 'Undated set'),
        threat(ACTOR_ID, 'Active actor', actorSeen),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID),
        attributedTo('set-ta', SET_ID, ACTOR_ID),
      ]);

      await recompute();

      expect(await activityOf(ACTOR_ID)).toEqual({ lastObservedAt: new Date(actorSeen) });
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: null });
      expect(await activityOf(CAMPAIGN_ID)).toEqual({ lastObservedAt: null });
    });

    it('should not date anything from an inferred attribution alone', async () => {
      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', daysAgo(10)),
        threat(SET_ID, 'Undated set'),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID, { extensions: { [OPENCTI_EXTENSION]: { is_inferred: true } } }),
      ]);

      await recompute();

      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: null });
    });

    it('should not date any of the four actors a campaign is attributed to', async () => {
      const actors = [4, 5, 6, 7].map((suffix) => stixId('threat-actor', suffix));
      await upload([
        threat(CAMPAIGN_ID, 'Shared campaign', daysAgo(10)),
        ...actors.map((id, index) => threat(id, `Actor ${index}`)),
        ...actors.map((id, index) => attributedTo(`c-ta-${index}`, CAMPAIGN_ID, id)),
      ]);

      await recompute();

      for (const id of actors) {
        expect(await activityOf(id)).toEqual({ lastObservedAt: null });
      }
    });

    it('should date from an attribution below the confidence gate only once the gate goes under its confidence', async () => {
      const seen = daysAgo(10);
      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', seen),
        threat(SET_ID, 'Undated set'),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID, { confidence: 50 }),
      ]);

      await recompute();
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: null });

      await setGate(40);
      await recompute();

      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: new Date(seen) });
    });

    it('should redate an intrusion set when its campaign is imported again with a later date, without importing the set', async () => {
      const older = daysAgo(200);
      await upload([threat(CAMPAIGN_ID, 'Dated campaign', older), threat(SET_ID, 'Undated set'), attributedTo('c-set', CAMPAIGN_ID, SET_ID)]);
      await recompute();
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: new Date(older) });
      expect(activityGradeFor((await activityOf(SET_ID)).lastObservedAt ?? null, new Date())).toBe('cold');
      const setBefore = await threatRow(SET_ID);
      const seen = daysAgo(3);

      await upload([threat(CAMPAIGN_ID, 'Dated campaign', seen), attributedTo('c-set', CAMPAIGN_ID, SET_ID)]);
      const result = await recompute();

      expect(result.scope).toBe('changed');
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: new Date(seen) });
      expect((await threatRow(SET_ID))?.updatedAt).toEqual(setBefore?.updatedAt);
    });

    it('should stop dating an intrusion set once its campaign is attributed to more actors than the cap, without importing the set', async () => {
      const actors = [4, 5, 6].map((suffix) => stixId('threat-actor', suffix));
      const seen = daysAgo(10);
      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', seen),
        threat(SET_ID, 'Undated set'),
        ...actors.map((id, index) => threat(id, `Actor ${index}`)),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID),
      ]);
      await recompute();
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: new Date(seen) });

      await upload([
        threat(CAMPAIGN_ID, 'Dated campaign', seen),
        attributedTo('c-set', CAMPAIGN_ID, SET_ID),
        ...actors.map((id, index) => attributedTo(`c-ta-${index}`, CAMPAIGN_ID, id)),
      ]);
      const result = await recompute();

      expect(result.scope).toBe('changed');
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: null });
      expect((await threatRow(SET_ID))?.lastObservedViaAnalysisId).toBeNull();
    });

    it('should stop dating an intrusion set once its campaign is no longer attributed to it, without importing the set', async () => {
      const seen = daysAgo(10);
      await upload([threat(CAMPAIGN_ID, 'Dated campaign', seen), threat(SET_ID, 'Undated set'), attributedTo('c-set', CAMPAIGN_ID, SET_ID)]);
      await recompute();
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: new Date(seen) });

      await upload([threat(CAMPAIGN_ID, 'Dated campaign', seen)]);
      const result = await recompute();

      expect(result.scope).toBe('changed');
      expect(await activityOf(SET_ID)).toEqual({ lastObservedAt: null });
      expect((await threatRow(SET_ID))?.lastObservedViaAnalysisId).toBeNull();
    });

    describe('a lost intermediate link', () => {
      const uploadChain = async (seen: string) => {
        await upload([
          threat(CAMPAIGN_ID, 'Dated campaign', seen),
          threat(SET_ID, 'Undated set'),
          threat(ACTOR_ID, 'Undated actor'),
          attributedTo('c-set', CAMPAIGN_ID, SET_ID),
          attributedTo('set-ta', SET_ID, ACTOR_ID),
        ]);
        await recompute();
        expect((await threatRow(ACTOR_ID))?.lastObservedViaAnalysisId).toBe(await threatId(CAMPAIGN_ID));
      };

      it('should stop dating a threat actor once its intrusion set is imported again without the attribution to it', async () => {
        await uploadChain(daysAgo(10));

        await upload([threat(SET_ID, 'Undated set')]);
        const result = await recompute();

        expect(result.scope).toBe('changed');
        expect(await activityOf(ACTOR_ID)).toEqual({ lastObservedAt: null });
        expect((await threatRow(ACTOR_ID))?.lastObservedViaAnalysisId).toBeNull();
      });

      it('should stop dating a threat actor once the intrusion set between it and the campaign is deleted', async () => {
        await uploadChain(daysAgo(10));

        await services.withOrigin(adminOrigin).threatAnalyses.deleteImported([await threatId(SET_ID)]);
        const result = await recompute();

        expect(result.scope).toBe('changed');
        expect(await activityOf(ACTOR_ID)).toEqual({ lastObservedAt: null });
        expect((await threatRow(ACTOR_ID))?.lastObservedViaAnalysisId).toBeNull();
      });
    });
  });

  describe('Threat Center list', () => {
    it('should filter the list on a threat type', async () => {
      await upload(THREAT_ACTOR_OBJECTS, CAMPAIGN_OBJECTS, INTRUSION_SET_OBJECTS);

      const { items, total } = await services.withOrigin(adminOrigin).threatAnalyses.list({ page: 1, limit: 50, sortDesc: true, entityType: 'campaign' });

      expect(total).toBe(1);
      expect(items.map((item) => item.name)).toEqual(['Operation Test Ledger']);
    });
  });

  describe('tenant isolation', () => {
    it('should show another tenant none of the threats, their children or their attributions', async () => {
      await upload(THREAT_ACTOR_OBJECTS, CAMPAIGN_OBJECTS, INTRUSION_SET_OBJECTS);
      const other = await otherTenant();
      const scoped = services.withOrigin(other.origin).threatAnalyses;

      expect((await scoped.list({ page: 1, limit: 50, sortDesc: true })).total).toBe(0);
      expect(await scoped.getDetail(await threatId(THREAT_ACTOR))).toBeUndefined();
      expect((await scoped.getRelevantForScenario({
        attackOutcomeId: deriveSeedId(other.tenantId, AttackOutcome_FinancialFraudFundsTheft),
        countryIds: [],
        sectorIds: [(await services.withOrigin(other.origin).sectors.getSectors()).find((sector) => sector.name === 'Finance')!.id],
      })).items).toEqual([]);
    });

    it('should not resolve an attribution toward a threat of another tenant sharing its STIX id', async () => {
      const other = await otherTenant();
      await services.withOrigin(other.origin).threatAnalyses.ingestBundle(parseThreatBundle(bundleOf(THREAT_ACTOR_OBJECTS)), other.tenantId, 'stix-import');
      await upload(INTRUSION_SET_OBJECTS);

      const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(await threatId(INTRUSION_SET));

      expect(detail?.attributedTo).toEqual([]);
    });
  });
});

interface DataChangedEvent {
  tenantId?: string,
  table: string,
  op: string,
}

const isDataChangedEvent = (value: unknown): value is DataChangedEvent =>
  typeof value === 'object' && value !== null
  && 'table' in value && typeof value.table === 'string'
  && 'op' in value && typeof value.op === 'string';

describe('Threat satellite tables ring the data-changed doorbell', () => {
  const events: Array<DataChangedEvent> = [];
  let listener: pg.Client;
  let adminOrigin: EventOrigin;
  let tenantId: string;

  beforeAll(async () => {
    listener = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
    await listener.connect();
    listener.on('notification', (msg) => {
      const parsed: unknown = msg.payload ? JSON.parse(msg.payload) : null;
      if (isDataChangedEvent(parsed)) {
        events.push(parsed);
      }
    });
    await listener.query('LISTEN data_changed');
  });

  afterAll(async () => {
    await listener.end();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    events.length = 0;
  });

  const waitForTables = async (tables: ReadonlyArray<string>, op: string, timeoutMs = 5_000): Promise<Array<string>> => {
    const deadline = Date.now() + timeoutMs;
    const ringing = (): Array<string> => tables.filter((table) =>
      events.some((event) => event.table === table && event.op === op && event.tenantId === tenantId));
    while (ringing().length < tables.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return ringing();
  };

  const ingest = async () => services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(
    parseThreatBundle(bundleOf(THREAT_ACTOR_OBJECTS, INTRUSION_SET_OBJECTS)),
    tenantId,
    'stix-import',
  );

  const CLAIM_TABLES = [
    'threat_analyses',
    'threat_analysis_aliases',
    'threat_analysis_secondary_motives',
    'threat_analysis_goals',
    'threat_analysis_locations',
    'threat_analysis_sectors',
    'threat_analysis_cves',
    'threat_analysis_techniques',
    'threat_analysis_threat_actor_types',
    'threat_analysis_roles',
    'threat_analysis_attributions',
  ];

  it('should write and ring for the owning tenant on every claim table', async () => {
    await ingest();

    const inserted = [...CLAIM_TABLES, 'threat_analysis_outcome_probabilities'];
    expect(await waitForTables(inserted, 'INSERT')).toEqual(inserted);
  });

  it('should delete and ring for the owning tenant when a re-upload withdraws the claims', async () => {
    await ingest();
    events.length = 0;

    const withdrawn = parseThreatBundle(bundleOf(THREAT_ACTOR_OBJECTS, INTRUSION_SET_OBJECTS)).map((entry) => ({
      ...entry,
      threat: { ...entry.threat, primaryMotivation: null },
      aliases: [],
      secondaryMotivations: [],
      goals: [],
      threatActorTypes: [],
      roles: [],
      attributions: [],
      locations: [],
      sectors: [],
      cves: [],
      techniques: [],
    }));
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(withdrawn, tenantId, 'stix-import');

    const replaced = CLAIM_TABLES.filter((table) => table !== 'threat_analyses');
    expect(await waitForTables(replaced, 'DELETE')).toEqual(replaced);
  });

  it('should ring for the owning tenant on the three projection tables', async () => {
    await ingest();
    const job = (jobKind: string): EventOrigin => ({ type: 'job', tenantId, jobKind, interactive: false });
    await services.withOrigin(job('threat-activity-recompute')).threatActivity.recomputeActivity({ now: new Date(), isDailyBooking: false });
    await services.withOrigin(job('threat-list-projection-recompute')).threatAnalyses.recomputeListProjections();

    const projections = ['threat_activity_anchors', 'threat_analysis_counts', 'threat_outcome_scores'];
    expect(await waitForTables(projections, 'INSERT')).toEqual(projections);
  });
});
