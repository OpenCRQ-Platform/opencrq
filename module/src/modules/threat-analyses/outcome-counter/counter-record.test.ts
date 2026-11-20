import { describe, expect, it } from 'vitest';
import type { ParsedAttribution, ParsedSector, ParsedTechnique, ParsedThreat } from '../stix-bundle-parser';
import { parseThreatBundle } from '../stix-bundle-parser';
import { buildCounterParents, buildCounterRecord, orderParentsFirst } from './counter-record';
import { loadOutcomeCounter, OUTCOME_COUNTER_OUTCOMES } from './outcome-counter';

const provenance = {
  stixRelationId: 'relationship--0',
  producerStixId: null,
  producerName: null,
  isInferred: false,
  relCreated: null,
  relStartTime: null,
  relStopTime: null,
  relModified: null,
  relConfidence: null,
};

const makeEntry = (overrides: Partial<ParsedThreat> = {}, threat: Partial<ParsedThreat['threat']> = {}): ParsedThreat => ({
  threat: {
    stixId: 'intrusion-set--1',
    entityType: 'intrusion-set',
    name: 'Group One',
    description: null,
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
    ...threat,
  },
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
  malware: [],
  reports: [],
  ...overrides,
});

const attribution = (relationId: string, targetStixId: string): ParsedAttribution => ({ ...provenance, stixRelationId: relationId, targetStixId });
const report = (stixId: string, published: string | null, title = stixId): ParsedThreat['reports'][number] => ({
  stixId,
  title,
  summary: `Summary of ${stixId}`,
  labels: ['ransomware'],
  published: published === null ? null : new Date(published),
});

describe('buildCounterRecord', () => {
  it('carries the identity of the threat', () => {
    const record = buildCounterRecord(
      makeEntry({ aliases: ['G1', 'Alpha'] }, { stixId: 'intrusion-set--abc', name: 'Group Alpha' }),
      [],
    );
    expect(record).toMatchObject({ id: 'intrusion-set--abc', type: 'intrusion-set', name: 'Group Alpha', aliases: ['G1', 'Alpha'] });
  });

  it('titles a campaign with its name and any other threat with nothing', () => {
    expect(buildCounterRecord(makeEntry({}, { entityType: 'campaign', name: 'Campaign Beta' }), []).title).toBe('Campaign Beta');
    expect(buildCounterRecord(makeEntry({}, { entityType: 'intrusion-set' }), []).title).toBeNull();
    expect(buildCounterRecord(makeEntry({}, { entityType: 'threat-actor' }), []).title).toBeNull();
  });

  it('turns an absent description into an empty string and keeps a present one', () => {
    expect(buildCounterRecord(makeEntry(), []).description).toBe('');
    expect(buildCounterRecord(makeEntry({}, { description: 'Targets banks.' }), []).description).toBe('Targets banks.');
  });

  it('collapses the whitespace of the description', () => {
    expect(buildCounterRecord(makeEntry({}, { description: '  Targets\n\nbanks\t and  insurers. ' }), []).description).toBe('Targets banks and insurers.');
  });

  it('lists the primary motivation, then the secondary ones, without a missing or blank value', () => {
    const record = buildCounterRecord(
      makeEntry({ secondaryMotivations: ['ideology', '  ', 'personal-gain'] }, { primaryMotivation: 'organizational-gain' }),
      [],
    );
    expect(record.motivations).toEqual(['organizational-gain', 'ideology', 'personal-gain']);
  });

  it('lists the secondary motivations alone when there is no primary one', () => {
    expect(buildCounterRecord(makeEntry({ secondaryMotivations: ['ideology'] }), []).motivations).toEqual(['ideology']);
    expect(buildCounterRecord(makeEntry({}, { primaryMotivation: '' }), []).motivations).toEqual([]);
  });

  it('passes the goals through', () => {
    expect(buildCounterRecord(makeEntry({ goals: ['steal data', 'disrupt'] }), []).goals).toEqual(['steal data', 'disrupt']);
  });

  it('drops the labels naming their source', () => {
    const record = buildCounterRecord(makeEntry({}, { labels: ['source:feed', 'ransomware', 'source:other', 'pir:3'] }), []);
    expect(record.labels).toEqual(['ransomware', 'pir:3']);
  });

  it('names the sectors and the techniques by their own identifiers, without a confidence filter', () => {
    const sector = (name: string): ParsedSector => ({ ...provenance, stixId: `identity--${name}`, name, relConfidence: 5 });
    const technique = (mitreExternalId: string): ParsedTechnique => ({
      ...provenance, stixId: `attack-pattern--${mitreExternalId}`, name: `Technique ${mitreExternalId}`, mitreExternalId, relConfidence: 1,
    });
    const record = buildCounterRecord(
      makeEntry({ sectors: [sector('Finance'), sector('Energy')], techniques: [technique('T1566'), technique('T1566.001')] }),
      [],
    );
    expect(record.sectors).toEqual(['Finance', 'Energy']);
    expect(record.techniques).toEqual(['T1566', 'T1566.001']);
  });

  it('counts the distinct parents, not the relationships', () => {
    const record = buildCounterRecord(
      makeEntry({
        attributions: [
          attribution('relationship--a', 'intrusion-set--p1'),
          attribution('relationship--b', 'intrusion-set--p1'),
          attribution('relationship--c', 'threat-actor--p2'),
        ],
      }),
      [],
    );
    expect(record.parentCount).toBe(2);
  });

  it('hands the parents over as given', () => {
    const parents = [
      { inferred: true, probabilities: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], evidenceSufficient: true },
      { inferred: false, probabilities: null, evidenceSufficient: false },
    ];
    expect(buildCounterRecord(makeEntry(), parents).parents).toBe(parents);
  });

  it('maps the malware to a name and types, in the parser order', () => {
    const record = buildCounterRecord(
      makeEntry({
        malware: [
          { stixId: 'malware--2', name: 'Zeta', types: ['ransomware'] },
          { stixId: 'malware--1', name: 'Alpha', types: [] },
        ],
      }),
      [],
    );
    expect(record.malware).toEqual([{ name: 'Zeta', types: ['ransomware'] }, { name: 'Alpha', types: [] }]);
  });

  describe('reports', () => {
    it('maps a report to its title, summary and labels', () => {
      const record = buildCounterRecord(makeEntry({ reports: [report('report--1', '2025-01-01T00:00:00.000Z', 'A title')] }), []);
      expect(record.reports).toEqual([{ title: 'A title', summary: 'Summary of report--1', labels: ['ransomware'] }]);
    });

    it('sorts the most recent first, the undated last, ties by STIX id', () => {
      const record = buildCounterRecord(
        makeEntry({
          reports: [
            report('report--undated-b', null),
            report('report--old', '2020-01-01T00:00:00.000Z'),
            report('report--tie-b', '2025-06-01T00:00:00.000Z'),
            report('report--new', '2026-01-01T00:00:00.000Z'),
            report('report--tie-a', '2025-06-01T00:00:00.000Z'),
            report('report--undated-a', null),
          ],
        }),
        [],
      );
      expect(record.reports.map((entry) => entry.title)).toEqual([
        'report--new', 'report--tie-a', 'report--tie-b', 'report--old', 'report--undated-a', 'report--undated-b',
      ]);
    });

    it('keeps the eight first of ten, after the sort', () => {
      const reports = Array.from({ length: 10 }, (_, index) => report(`report--${index}`, index === 3 ? null : `2025-01-${String(index + 10)}T00:00:00.000Z`));
      const record = buildCounterRecord(makeEntry({ reports }), []);
      expect(record.reports).toHaveLength(8);
      // The oldest report--0 and the undated report--3 fall off the end.
      expect(record.reports.map((entry) => entry.title)).toEqual([
        'report--9', 'report--8', 'report--7', 'report--6', 'report--5', 'report--4', 'report--2', 'report--1',
      ]);
    });

    it('does not reorder the entry it was given', () => {
      const reports = [report('report--b', '2020-01-01T00:00:00.000Z'), report('report--a', '2025-01-01T00:00:00.000Z')];
      buildCounterRecord(makeEntry({ reports }), []);
      expect(reports.map((entry) => entry.stixId)).toEqual(['report--b', 'report--a']);
    });
  });
});

describe('the counter fed by a parsed bundle', () => {
  const GROUP_ID = 'intrusion-set--00000000-0000-4000-8000-0000000000a1';
  const MALWARE_ID = 'malware--00000000-0000-4000-8000-0000000000c1';

  it('predicts one probability per outcome from the record of an intrusion set', () => {
    const [entry] = parseThreatBundle({
      type: 'bundle',
      id: 'bundle--1',
      objects: [
        { type: 'intrusion-set', id: GROUP_ID, name: 'Group Alpha', description: 'Encrypts file servers and demands a ransom.', primary_motivation: 'financial-gain', labels: ['source:feed', 'ransomware'] },
        { type: 'malware', id: MALWARE_ID, name: 'Locker One', malware_types: ['ransomware'] },
        { type: 'relationship', id: 'relationship--1', relationship_type: 'uses', source_ref: GROUP_ID, target_ref: MALWARE_ID },
        {
          type: 'report',
          id: 'report--00000000-0000-4000-8000-0000000000d1',
          name: 'Group Alpha encrypts a hospital',
          description: 'The group deployed a locker and asked for a ransom.',
          published: '2025-03-04T10:00:00.000Z',
          object_refs: [GROUP_ID],
        },
      ],
    });

    const record = buildCounterRecord(entry, []);
    expect(record.malware).toEqual([{ name: 'Locker One', types: ['ransomware'] }]);
    expect(record.reports).toHaveLength(1);

    const probabilities = loadOutcomeCounter().predict(record);
    expect(probabilities).toHaveLength(OUTCOME_COUNTER_OUTCOMES.length);
    expect(probabilities).toHaveLength(7);
    for (const value of probabilities) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('orderParentsFirst', () => {
  const node = (stixId: string, ...parents: Array<string>) => makeEntry(
    { attributions: parents.map((parent, index) => attribution(`relationship--${stixId}-${index}`, parent)) },
    { stixId },
  );
  const idsOf = (entries: Array<ParsedThreat>): Array<string> => entries.map((entry) => entry.threat.stixId);

  it('puts a parent before its child whatever the input order', () => {
    expect(idsOf(orderParentsFirst([node('campaign--c', 'intrusion-set--g'), node('intrusion-set--g')])))
      .toEqual(['intrusion-set--g', 'campaign--c']);
  });

  it('orders a chain of three levels and more', () => {
    const chain = [node('d', 'c'), node('c', 'b'), node('b', 'a'), node('a')];
    expect(idsOf(orderParentsFirst(chain))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts every parent of a child before it', () => {
    const ordered = idsOf(orderParentsFirst([node('child', 'p1', 'p2'), node('p2'), node('p1')]));
    expect(ordered.indexOf('child')).toBe(2);
  });

  it('keeps the input order of the members of a cycle', () => {
    expect(idsOf(orderParentsFirst([node('a', 'b'), node('b', 'a')]))).toEqual(['a', 'b']);
    expect(idsOf(orderParentsFirst([node('b', 'a'), node('a', 'b')]))).toEqual(['b', 'a']);
  });

  it('still puts the parents of a cycle first, and its children after it', () => {
    const ordered = idsOf(orderParentsFirst([node('child', 'a'), node('a', 'b', 'root'), node('b', 'a'), node('root')]));
    expect(ordered).toEqual(['root', 'a', 'b', 'child']);
  });

  it('keeps unrelated entries in their input order', () => {
    expect(idsOf(orderParentsFirst([node('z'), node('m'), node('a')]))).toEqual(['z', 'm', 'a']);
  });

  it('ignores a parent outside the batch and an entry naming itself', () => {
    expect(idsOf(orderParentsFirst([node('b', 'absent'), node('a', 'a')]))).toEqual(['b', 'a']);
  });

  it('keeps an entry once even when it names the same parent through two relationships', () => {
    expect(idsOf(orderParentsFirst([node('c', 'p', 'p'), node('p')]))).toEqual(['p', 'c']);
  });

  it('orders a very long chain without exhausting the stack', () => {
    const length = 20_000;
    const reversed = Array.from({ length }, (_, index) => node(`n${length - index}`, `n${length - index - 1}`));
    const expected = Array.from({ length }, (_, index) => `n${index + 1}`);
    expect(idsOf(orderParentsFirst(reversed))).toEqual(expected);
  });
});

describe('buildCounterParents', () => {
  const rowIdByCatalogId = new Map(OUTCOME_COUNTER_OUTCOMES.map((catalogId, index) => [`row-${index}`, catalogId]));
  const storedFor = (stixId: string, skip: ReadonlyArray<number> = [], evidenceSufficient = true) => OUTCOME_COUNTER_OUTCOMES
    .map((_, index) => ({ stixId, attackOutcomeId: `row-${index}`, probability: (index + 1) / 10, evidenceSufficient }))
    .filter((_, index) => !skip.includes(index));
  const link = (targetStixId: string, isInferred = false) => ({ targetStixId, isInferred });

  it('hands over the stored percentages of a parent in the counter\'s order', () => {
    const stored = [...storedFor('intrusion-set--g')].reverse();
    expect(buildCounterParents([link('intrusion-set--g')], stored, rowIdByCatalogId))
      .toEqual([{ inferred: false, probabilities: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], evidenceSufficient: true }]);
  });

  it('reads one parent per target, inferred only when every relationship to it is', () => {
    const parents = buildCounterParents(
      [link('a', true), link('a', false), link('b', true)],
      [...storedFor('a'), ...storedFor('b')],
      rowIdByCatalogId,
    );
    expect(parents.map((parent) => parent.inferred)).toEqual([false, true]);
  });

  it('gives null for a parent with no stored percentages, or whose percentages are incomplete', () => {
    const parents = buildCounterParents([link('absent'), link('partial')], storedFor('partial', [3]), rowIdByCatalogId);
    expect(parents.map((parent) => parent.probabilities)).toEqual([null, null]);
  });

  it('ignores a stored row naming an outcome the counter does not know', () => {
    const stored = [...storedFor('a'), { stixId: 'a', attackOutcomeId: 'row-custom', probability: 0.99, evidenceSufficient: true }];
    expect(buildCounterParents([link('a')], stored, rowIdByCatalogId)[0].probabilities).toHaveLength(OUTCOME_COUNTER_OUTCOMES.length);
  });

  it('flags a parent without minimum evidence, still handing over its percentages', () => {
    const [parent] = buildCounterParents([link('a')], storedFor('a', [], false), rowIdByCatalogId);
    expect(parent).toEqual({ inferred: false, probabilities: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], evidenceSufficient: false });
  });
});
