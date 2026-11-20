import type { EventOrigin, ParsedThreatInput } from '@app/module';
import {
  AttackOutcome_Espionage,
  AttackOutcome_Ransomware,
  defaultThreatsRepository,
  defaultThreatStixId,
  deriveSeedId,
  mitreTechniquesData,
  OUTCOME_COUNTER_OUTCOMES,
  parseDefaultThreatsDataset,
  threatAnalyses,
} from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { readStoredProbability } from '../../helpers/threat-analyses-fixtures';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const RECORD = { etag: '"v1"', lastModified: null, appVersion: null };

const mitreRef = (externalId: string) => [{ source_name: 'mitre-attack', external_id: externalId }];

/** The STIX id a use cites a technique by, as the catalogue holds it. */
const PHISHING_STIX_ID = mitreTechniquesData.find((technique) => technique.externalId === 'T1566')?.stixId ?? '';

/** A dataset file holding one group per MITRE id, each using T1566, and the outcome and actor class assessments given by MITRE id. */
const datasetOf = (
  mitreIds: Array<string>,
  judged: Record<string, Record<string, number>> = {},
  classes: Record<string, string> = {},
) => parseDefaultThreatsDataset({
  type: 'bundle',
  id: 'bundle--1',
  objects: [
    { type: 'x-opencrq-dataset-release', id: 'x-opencrq-dataset-release--1', attack_release: '20.0' },
    ...mitreIds.flatMap((mitreId) => [
      { type: 'intrusion-set', id: `intrusion-set--${mitreId}`, name: `Group ${mitreId}`, external_references: mitreRef(mitreId) },
      {
        type: 'relationship', id: `relationship--${mitreId}`, relationship_type: 'uses',
        source_ref: `intrusion-set--${mitreId}`, target_ref: PHISHING_STIX_ID,
      },
    ]),
    ...Object.entries(judged).map(([mitreId, probabilities]) => ({
      type: 'x-opencrq-outcome-assessment', id: `x-opencrq-outcome-assessment--${mitreId}`, object_ref: `intrusion-set--${mitreId}`,
      method: 'judged', modified: '2026-11-02T00:00:00.000Z', outcome_probabilities: probabilities,
    })),
    ...Object.entries(classes).map(([mitreId, actorClass]) => ({
      type: 'x-opencrq-actor-class-assessment', id: `x-opencrq-actor-class-assessment--${mitreId}`, object_ref: `intrusion-set--${mitreId}`,
      method: 'judged', modified: '2026-11-06T00:00:00.000Z', actor_class: actorClass,
    })),
  ],
});

/** Every outcome the counter assesses, at 0: a threat judged to lead to none of them. */
const NONE = Object.fromEntries(OUTCOME_COUNTER_OUTCOMES.map((outcomeId) => [outcomeId, 0]));

/** A hand-uploaded STIX object, under MITRE's own STIX id and the same MITRE id as a connector threat. */
const uploaded = (mitreId: string): ParsedThreatInput => ({
  threat: {
    stixId: `intrusion-set--${mitreId}`, entityType: 'intrusion-set', name: `Group ${mitreId}`, description: null, mitreGroupId: mitreId,
    confidence: 60, stixCreated: null, firstSeen: null, lastSeen: null, primaryMotivation: null, resourceLevel: null,
    sophistication: null, objective: null, labels: [],
  },
  aliases: [], secondaryMotivations: [], goals: [], threatActorTypes: [], roles: [], attributions: [], locations: [], sectors: [], cves: [], techniques: [],
});

describe('Default Threats service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  const job = (forTenantId: string) => services.withOrigin({ type: 'job', tenantId: forTenantId, jobKind: 'default-threats-sync', interactive: false });

  const heldBySource = async (origin: EventOrigin) =>
    (await services.withOrigin(origin).threatAnalyses.list({ page: 1, limit: 100, sortBy: 'name', sortDesc: false }))
      .items.map((item) => `${item.kind}:${item.mitreGroupId}`).sort();

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  it('should read a tenant with no settings row as enabled, with nothing loaded', async () => {
    expect(await services.withOrigin(adminOrigin).defaultThreats.getSettings(tenantId))
      .toMatchObject({ enabled: true, etag: null, loadedAt: null });
  });

  it('should load the dataset\'s threats and record the load', async () => {
    const loaded = await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001', 'G0002']), RECORD);

    expect(loaded).toEqual({ created: 2, updated: 0, retracted: 0 });
    expect(await heldBySource(adminOrigin)).toEqual(['default-threats:G0001', 'default-threats:G0002']);
    expect(await services.withOrigin(adminOrigin).defaultThreats.getSettings(tenantId))
      .toMatchObject({ enabled: true, etag: '"v1"', attackRelease: '20.0', loadedAt: expect.any(Date) });
  });

  it('should retract a threat a newer file drops, and not count the ones it keeps unchanged as updated', async () => {
    await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001', 'G0002']), RECORD);
    const loaded = await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0002', 'G0003']), { ...RECORD, etag: '"v2"' });

    expect(loaded).toEqual({ created: 1, updated: 0, retracted: 1 });
    expect(await heldBySource(adminOrigin)).toEqual(['default-threats:G0002', 'default-threats:G0003']);
  });

  it('should refuse a dataset with no threat, keeping what the tenant holds and the load it recorded', async () => {
    await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001', 'G0002']), RECORD);

    await expect(job(tenantId).defaultThreats.loadDataset(datasetOf([]), { ...RECORD, etag: '"v2"' })).rejects.toThrow('holds no group or campaign');

    expect(await heldBySource(adminOrigin)).toEqual(['default-threats:G0001', 'default-threats:G0002']);
    expect(await services.withOrigin(adminOrigin).defaultThreats.getSettings(tenantId)).toMatchObject({ etag: '"v1"' });
  });

  it('should leave a hand upload of the same groups beside the connector\'s, through a load and a switch-off', async () => {
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([uploaded('G0001')], tenantId, 'stix-import');
    await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), RECORD);
    expect(await heldBySource(adminOrigin)).toEqual(['default-threats:G0001', 'stix-import:G0001']);

    await services.withOrigin(adminOrigin).defaultThreats.setEnabled(false);
    expect(await heldBySource(adminOrigin)).toEqual(['stix-import:G0001']);
  });

  it('should remove the connector\'s threats and forget the load when switched off', async () => {
    await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001', 'G0002']), RECORD);

    const { retracted } = await services.withOrigin(adminOrigin).defaultThreats.setEnabled(false);

    expect(retracted).toBe(2);
    expect(await services.withOrigin(adminOrigin).defaultThreats.getSettings(tenantId))
      .toMatchObject({ enabled: false, etag: null, attackRelease: null, loadedAt: null });
  });

  it('should load nothing on a tenant that switched the connector off', async () => {
    await services.withOrigin(adminOrigin).defaultThreats.setEnabled(false);

    const loaded = await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), RECORD);

    expect(loaded).toEqual({ created: 0, updated: 0, retracted: 0 });
    expect(await heldBySource(adminOrigin)).toEqual([]);
  });

  it('should record no load on a tenant switched off after the load last read it as on', async () => {
    await services.withOrigin(adminOrigin).defaultThreats.setEnabled(false);

    await defaultThreatsRepository.saveLoadRecord(
      repositoryContextOf(db, { type: 'job', tenantId, jobKind: 'default-threats-sync', interactive: false }),
      tenantId,
      { ...RECORD, attackRelease: '20.0' },
      uuidv7(),
    );

    expect(await services.withOrigin(adminOrigin).defaultThreats.getSettings(tenantId))
      .toMatchObject({ enabled: false, etag: null, loadedAt: null });
  });

  it('should count the connector\'s threats apart from every other source\'s', async () => {
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([uploaded('G0009')], tenantId, 'stix-import');
    await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001', 'G0002']), RECORD);

    expect(await services.withOrigin(adminOrigin).defaultThreats.countThreats())
      .toEqual({ own: 2, others: 1, groups: 2, campaigns: 0 });
  });

  it('should touch no other tenant\'s threats or settings', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const other = { tenantId: otherTenantId, origin: { type: 'client' as const, userId: adminUserId, tenantId: otherTenantId } };
    await job(other.tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), RECORD);
    await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), RECORD);

    await services.withOrigin(adminOrigin).defaultThreats.setEnabled(false);

    expect(await heldBySource(other.origin)).toEqual(['default-threats:G0001']);
    expect(await services.withOrigin(other.origin).defaultThreats.getSettings(other.tenantId)).toMatchObject({ enabled: true, etag: '"v1"' });
  });

  describe('judged outcome probabilities', () => {
    const analysisOf = async (mitreId: string) =>
      (await db.select().from(threatAnalyses)
        .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, defaultThreatStixId(mitreId)))))[0];
    const stored = (mitreId: string, catalogId: string) => readStoredProbability(db, defaultThreatStixId(mitreId), deriveSeedId(tenantId, catalogId));

    it('should store a judged threat\'s probabilities instead of the counter\'s, with the date of its judgment set', async () => {
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001'], { G0001: { [AttackOutcome_Espionage]: 0.97, [AttackOutcome_Ransomware]: 0.02 } }), RECORD);

      expect(await stored('G0001', AttackOutcome_Espionage)).toBe(0.97);
      expect(await stored('G0001', AttackOutcome_Ransomware)).toBe(0.02);
      expect(await analysisOf('G0001')).toMatchObject({ outcomeJudgedAt: new Date('2026-11-02T00:00:00.000Z'), outcomeEvidenceSufficient: true });
    });

    it('should leave the counter\'s value on an outcome the judgment does not state', async () => {
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), RECORD);
      const counted = await stored('G0001', AttackOutcome_Ransomware);

      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001'], { G0001: { [AttackOutcome_Espionage]: 0.97 } }), { ...RECORD, etag: '"v2"' });

      expect(await stored('G0001', AttackOutcome_Espionage)).toBe(0.97);
      expect(await stored('G0001', AttackOutcome_Ransomware)).toBe(counted);
    });

    // The groups here carry no description, which leaves the counter without enough evidence.
    it('should count a threat judged to lead to no outcome as having enough evidence, and an unjudged one as the counter does', async () => {
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001', 'G0002'], { G0001: NONE }), RECORD);

      for (const outcomeId of OUTCOME_COUNTER_OUTCOMES) {
        expect(await stored('G0001', outcomeId)).toBe(0);
      }
      expect(await analysisOf('G0001')).toMatchObject({ outcomeEvidenceSufficient: true });
      expect(await analysisOf('G0002')).toMatchObject({ outcomeJudgedAt: null, outcomeEvidenceSufficient: false });
    });

    it('should give a threat back to the counter when a newer file no longer judges it', async () => {
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), RECORD);
      const counted = await stored('G0001', AttackOutcome_Espionage);
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001'], { G0001: { [AttackOutcome_Espionage]: 0.97 } }), { ...RECORD, etag: '"v2"' });

      const loaded = await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), { ...RECORD, etag: '"v3"' });

      expect(loaded).toEqual({ created: 0, updated: 1, retracted: 0 });
      expect(await stored('G0001', AttackOutcome_Espionage)).toBe(counted);
      expect(await analysisOf('G0001')).toMatchObject({ outcomeJudgedAt: null });
    });

    it('should not count a judged threat as updated when the same file is loaded again', async () => {
      const dataset = datasetOf(['G0001'], { G0001: { [AttackOutcome_Espionage]: 0.97 } });
      await job(tenantId).defaultThreats.loadDataset(dataset, RECORD);

      expect(await job(tenantId).defaultThreats.loadDataset(dataset, { ...RECORD, etag: '"v2"' })).toEqual({ created: 0, updated: 0, retracted: 0 });
    });
  });

  describe('stated actor class', () => {
    const classOf = async (mitreId: string) =>
      (await db.select({ actorClass: threatAnalyses.actorClass }).from(threatAnalyses)
        .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, defaultThreatStixId(mitreId)))))[0]?.actorClass;

    it('should store the class the file states, and the default class for a threat it does not class', async () => {
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001', 'G0002'], {}, { G0001: 'state_sponsored' }), RECORD);

      expect(await classOf('G0001')).toBe('state_sponsored');
      expect(await classOf('G0002')).toBe('default');
    });

    it('should update a threat a newer file classes differently', async () => {
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001'], {}, { G0001: 'state_sponsored' }), RECORD);

      const loaded = await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001'], {}, { G0001: 'ransomware_operator' }), { ...RECORD, etag: '"v2"' });

      expect(loaded).toEqual({ created: 0, updated: 1, retracted: 0 });
      expect(await classOf('G0001')).toBe('ransomware_operator');
    });

    it('should give a threat back the default class when a newer file no longer classes it', async () => {
      await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001'], {}, { G0001: 'state_sponsored' }), RECORD);

      const loaded = await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), { ...RECORD, etag: '"v2"' });

      expect(loaded).toEqual({ created: 0, updated: 1, retracted: 0 });
      expect(await classOf('G0001')).toBe('default');
    });

    it('should not count a classed threat as updated when the same file is loaded again', async () => {
      const dataset = datasetOf(['G0001'], {}, { G0001: 'state_sponsored' });
      await job(tenantId).defaultThreats.loadDataset(dataset, RECORD);

      expect(await job(tenantId).defaultThreats.loadDataset(dataset, { ...RECORD, etag: '"v2"' })).toEqual({ created: 0, updated: 0, retracted: 0 });
    });
  });

  it('should forget the load on a reset, keeping the threats', async () => {
    await job(tenantId).defaultThreats.loadDataset(datasetOf(['G0001']), RECORD);

    await services.withOrigin(adminOrigin).defaultThreats.forgetLoad();

    expect(await services.withOrigin(adminOrigin).defaultThreats.getSettings(tenantId)).toMatchObject({ enabled: true, etag: null, loadedAt: null });
    expect(await heldBySource(adminOrigin)).toEqual(['default-threats:G0001']);
  });
});
