import type { EventOrigin } from '@app/module';
import {
  AttackOutcome_Ransomware,
  deriveSeedId,
  OUTCOME_COUNTER_OUTCOMES,
  OUTCOME_COUNTER_VERSION,
  parseThreatBundle,
  threatAnalyses,
  threatAnalysisOutcomeProbabilities,
} from '@app/module';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const GROUP = 'intrusion-set--bbbbbbbb-0000-4000-8000-000000000001';
const CAMPAIGN = 'campaign--bbbbbbbb-0000-4000-8000-000000000002';
const BARE_GROUP = 'intrusion-set--bbbbbbbb-0000-4000-8000-000000000003';
const REPORT = 'report--bbbbbbbb-0000-4000-8000-000000000004';
const LONE_CAMPAIGN = 'campaign--bbbbbbbb-0000-4000-8000-000000000005';

const groupObject = {
  type: 'intrusion-set',
  id: GROUP,
  name: 'Harbor Locksmiths',
  description: 'The group encrypts files on victim networks and demands a ransom payment in exchange for the decryption key.',
  confidence: 80,
};

// No description, motivation, goal or report: nothing the counter could call evidence.
const campaignObject = { type: 'campaign', id: CAMPAIGN, name: 'Operation Quiet Harbor', confidence: 80 };

const attributedTo = (id: string, sourceRef: string, targetRef: string) => ({
  type: 'relationship',
  id: `relationship--${id}`,
  relationship_type: 'attributed-to',
  source_ref: sourceRef,
  target_ref: targetRef,
  confidence: 80,
});

const reportObject = {
  type: 'report',
  id: REPORT,
  name: 'Quiet exfiltration of customer records',
  description: 'Operators copied customer databases out of the network and put the records up for sale on a criminal forum, '
    + 'then threatened to publish the rest unless the victim paid. No file was encrypted.',
  published: '2026-10-01T00:00:00.000Z',
  labels: ['data-theft', 'extortion'],
  object_refs: [GROUP],
};

const bundleOf = (...objects: Array<Record<string, unknown>>) => ({
  type: 'bundle',
  id: 'bundle--bbbbbbbb-0000-4000-8000-0000000000ff',
  objects,
});

describe('Outcome counter at ingestion', () => {
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

  /** The STIX ids whose percentages the ingestion moved. */
  const ingest = async (objects: Array<Record<string, unknown>>, origin: EventOrigin = adminOrigin, forTenantId: string = tenantId) => {
    const moved: Array<string> = [];
    await services.withOrigin(origin).threatAnalyses
      .ingestBundle(parseThreatBundle(bundleOf(...objects)), forTenantId, 'stix-import', { onProbabilitiesChanged: (stixId) => moved.push(stixId) });
    return moved.sort();
  };

  const analysisOf = async (stixId: string, forTenantId: string = tenantId) => {
    const row = (await db.select().from(threatAnalyses)
      .where(and(eq(threatAnalyses.tenantId, forTenantId), eq(threatAnalyses.stixId, stixId)))).at(0);
    if (!row) {
      throw new Error(`No threat for ${stixId}`);
    }
    return row;
  };

  const probabilitiesOf = async (stixId: string, forTenantId: string = tenantId): Promise<Map<string, number>> => {
    const analysis = await analysisOf(stixId, forTenantId);
    const rows = await db.select().from(threatAnalysisOutcomeProbabilities)
      .where(eq(threatAnalysisOutcomeProbabilities.analysisId, analysis.id));
    return new Map(rows.map((row) => [row.attackOutcomeId, row.probability]));
  };

  const ransomwareOf = async (stixId: string): Promise<number> =>
    (await probabilitiesOf(stixId)).get(deriveSeedId(tenantId, AttackOutcome_Ransomware))!;

  it('should write a percentage per counter outcome, the model version and the evidence flag, parent and child alike', async () => {
    await ingest([campaignObject, attributedTo('c-g', CAMPAIGN, GROUP), groupObject]);

    for (const stixId of [GROUP, CAMPAIGN]) {
      const probabilities = await probabilitiesOf(stixId);
      expect([...probabilities.keys()].sort()).toEqual(OUTCOME_COUNTER_OUTCOMES.map((id) => deriveSeedId(tenantId, id)).sort());
      expect([...probabilities.values()].every((value) => value >= 0 && value <= 1)).toBe(true);
      expect((await analysisOf(stixId)).outcomeModelVersion).toBe(OUTCOME_COUNTER_VERSION);
    }
    expect(await ransomwareOf(GROUP)).toBeGreaterThan(0.5);
  });

  it('should let a campaign with no data of its own count as evidenced through its group, whichever comes first in the bundle', async () => {
    await ingest([campaignObject, { ...campaignObject, id: LONE_CAMPAIGN }, attributedTo('c-g', CAMPAIGN, GROUP), groupObject]);

    expect((await analysisOf(GROUP)).outcomeEvidenceSufficient).toBe(true);
    expect((await analysisOf(CAMPAIGN)).outcomeEvidenceSufficient).toBe(true);
    // The campaign read the percentages its group had just been given, not an absent parent: its unattributed twin reads lower.
    expect(await ransomwareOf(CAMPAIGN)).toBeGreaterThan(await ransomwareOf(LONE_CAMPAIGN));
  });

  it('should read the percentages of a parent ingested by an earlier call', async () => {
    await ingest([groupObject]);
    await ingest([campaignObject, attributedTo('c-g', CAMPAIGN, GROUP)]);

    expect((await analysisOf(CAMPAIGN)).outcomeEvidenceSufficient).toBe(true);
  });

  it('should not count a parent that was never ingested as evidence', async () => {
    await ingest([campaignObject, attributedTo('c-g', CAMPAIGN, GROUP)]);

    expect((await analysisOf(CAMPAIGN)).outcomeEvidenceSufficient).toBe(false);
  });

  it('should never read the percentages of a parent another tenant holds under the same STIX id', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
    await ingest([groupObject], otherOrigin, otherTenantId);

    await ingest([campaignObject, attributedTo('c-g', CAMPAIGN, GROUP)]);

    expect((await analysisOf(CAMPAIGN)).outcomeEvidenceSufficient).toBe(false);
  });

  it('should keep a threat with no description, motivation, report or known parent as not evidenced, with its percentages stored', async () => {
    await ingest([{ type: 'intrusion-set', id: BARE_GROUP, name: 'Nameless Collective', confidence: 80 }]);

    expect((await analysisOf(BARE_GROUP)).outcomeEvidenceSufficient).toBe(false);
    expect((await probabilitiesOf(BARE_GROUP)).size).toBe(OUTCOME_COUNTER_OUTCOMES.length);
  });

  it('should not count a parent without minimum evidence as the evidence of its campaign, until the parent has some', async () => {
    const bareGroup = { type: 'intrusion-set', id: BARE_GROUP, name: 'Nameless Collective', confidence: 80 };
    await ingest([bareGroup, campaignObject, attributedTo('c-b', CAMPAIGN, BARE_GROUP)]);

    expect((await analysisOf(CAMPAIGN)).outcomeEvidenceSufficient).toBe(false);

    await ingest([{ ...bareGroup, description: groupObject.description }, campaignObject, attributedTo('c-b', CAMPAIGN, BARE_GROUP)]);

    expect((await analysisOf(CAMPAIGN)).outcomeEvidenceSufficient).toBe(true);
  });

  it('should leave the percentages as they were when the same bundle is ingested again', async () => {
    const first = await ingest([campaignObject, attributedTo('c-g', CAMPAIGN, GROUP), groupObject]);
    const before = [await probabilitiesOf(GROUP), await probabilitiesOf(CAMPAIGN)];

    const second = await ingest([campaignObject, attributedTo('c-g', CAMPAIGN, GROUP), groupObject]);

    expect([await probabilitiesOf(GROUP), await probabilitiesOf(CAMPAIGN)]).toEqual(before);
    expect(first).toEqual([CAMPAIGN, GROUP]);
    expect(second).toEqual([]);
  });

  it('should move the percentages of a threat a report now cites, and name it as changed', async () => {
    await ingest([groupObject]);
    const without = await probabilitiesOf(GROUP);

    const moved = await ingest([groupObject, reportObject]);

    expect(await probabilitiesOf(GROUP)).not.toEqual(without);
    expect(moved).toEqual([GROUP]);
    // The report says nothing is encrypted and the data is stolen: ransomware must not gain on it.
    expect(await ransomwareOf(GROUP)).toBeLessThan(without.get(deriveSeedId(tenantId, AttackOutcome_Ransomware))!);
  });

  it('should move the updated_at of a threat whose percentages alone moved, so the list projections fold them again', async () => {
    await ingest([groupObject, campaignObject, attributedTo('c-g', CAMPAIGN, GROUP)]);
    await ingest([groupObject, reportObject]);
    const before = await analysisOf(CAMPAIGN);
    const percentagesBefore = await probabilitiesOf(CAMPAIGN);

    const moved = await ingest([campaignObject, attributedTo('c-g', CAMPAIGN, GROUP)]);

    expect(moved).toEqual([CAMPAIGN]);
    expect(await probabilitiesOf(CAMPAIGN)).not.toEqual(percentagesBefore);
    expect((await analysisOf(CAMPAIGN)).updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it('should name a threat whose evidence flag flipped although its percentages did not move', async () => {
    const sameEveryTime = { version: OUTCOME_COUNTER_VERSION, predict: () => OUTCOME_COUNTER_OUTCOMES.map((_, index) => (index + 1) / 10) };
    const ingestScored = async (objects: Array<Record<string, unknown>>) => {
      const moved: Array<string> = [];
      await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(
        parseThreatBundle(bundleOf(...objects)),
        tenantId,
        'stix-import',
        { onProbabilitiesChanged: (stixId) => moved.push(stixId), counter: sameEveryTime },
      );
      return moved;
    };
    const bareGroup = { type: 'intrusion-set', id: BARE_GROUP, name: 'Nameless Collective', confidence: 80 };
    await ingestScored([bareGroup]);
    const before = await probabilitiesOf(BARE_GROUP);
    expect((await analysisOf(BARE_GROUP)).outcomeEvidenceSufficient).toBe(false);

    const moved = await ingestScored([{ ...bareGroup, description: groupObject.description }]);

    expect((await analysisOf(BARE_GROUP)).outcomeEvidenceSufficient).toBe(true);
    expect(await probabilitiesOf(BARE_GROUP)).toEqual(before);
    expect(moved).toEqual([BARE_GROUP]);
  });

  describe('rescore of a stored file for a new model', () => {
    const rescore = (objects: Array<Record<string, unknown>>) => services.withOrigin(adminOrigin).threatAnalyses
      .ingestBundle(parseThreatBundle(bundleOf(...objects)), tenantId, 'stix-import', { rescoreOnly: true });

    const scoredUnder = (stixId: string, version: string | null) => db.update(threatAnalyses).set({ outcomeModelVersion: version })
      .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, stixId)));

    it('should rewrite a threat scored under another model version', async () => {
      await ingest([groupObject]);
      await scoredUnder(GROUP, '2020.01');

      const result = await rescore([{ ...groupObject, name: 'Harbor Locksmiths (rescored)' }]);

      expect(result).toEqual({ created: 0, updated: 1, unchanged: 0, skipped: 0 });
      const analysis = await analysisOf(GROUP);
      expect(analysis.outcomeModelVersion).toBe(OUTCOME_COUNTER_VERSION);
      expect(analysis.name).toBe('Harbor Locksmiths (rescored)');
    });

    it('should not bring back a threat deleted since the file was uploaded', async () => {
      const result = await rescore([groupObject]);

      expect(result).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 1 });
      expect(await db.select().from(threatAnalyses).where(eq(threatAnalyses.tenantId, tenantId))).toEqual([]);
    });

    it('should leave alone a threat a newer ingestion already scored under the current model', async () => {
      await ingest([{ ...groupObject, name: 'Harbor Locksmiths (newer)' }]);

      const result = await rescore([groupObject]);

      expect(result).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 1 });
      expect((await analysisOf(GROUP)).name).toBe('Harbor Locksmiths (newer)');
    });
  });
});
