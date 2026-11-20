import { describe, expect, it } from 'vitest';
import { AttackOutcome_Espionage, AttackOutcome_Ransomware } from '../attack-outcomes/data/attack-outcomes-ids';
import { mitreTechniquesData } from '../mitre-attack/data/mitre-techniques';
import { DEFAULT_THREATS_CONFIDENCE, defaultThreatStixId, parseDefaultThreatsDataset } from './dataset';

const MITRE = 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5';

const mitreRef = (externalId: string) => [{ source_name: 'mitre-attack', external_id: externalId }];

/** The STIX id a use cites a technique by, as the catalogue holds it. */
const techniqueStixId = (externalId: string): string => {
  const technique = mitreTechniquesData.find((candidate) => candidate.externalId === externalId);
  if (technique === undefined) {
    throw new Error(`${externalId} is not in the catalogue`);
  }
  return technique.stixId;
};

const group = (id: string, mitreId: string, extra: Record<string, unknown> = {}) => ({
  type: 'intrusion-set', id, name: `Group ${mitreId}`, aliases: [`Group ${mitreId}`, `Alias ${mitreId}`],
  created: '2017-05-31T21:31:52.748Z', external_references: mitreRef(mitreId), ...extra,
});

const uses = (id: string, source: string, target: string) => ({
  type: 'relationship', id, relationship_type: 'uses', source_ref: source, target_ref: target, created_by_ref: MITRE,
});

const release = (attackRelease: string) => ({
  type: 'x-opencrq-dataset-release', id: 'x-opencrq-dataset-release--1', attack_release: attackRelease,
});

const assessment = (id: string, objectRef: string, probabilities: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'x-opencrq-outcome-assessment', spec_version: '2.1', id, object_ref: objectRef, method: 'judged',
  created: '2026-11-02T00:00:00.000Z', modified: '2026-11-02T00:00:00.000Z', outcome_probabilities: probabilities, ...extra,
});

const classAssessment = (id: string, objectRef: string, actorClass: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'x-opencrq-actor-class-assessment', spec_version: '2.1', id, object_ref: objectRef, method: 'judged',
  created: '2026-11-06T00:00:00.000Z', modified: '2026-11-06T00:00:00.000Z', actor_class: actorClass, ...extra,
});

const bundle = (objects: Array<unknown>, objectsBefore: Array<unknown> = [release('20.0')]) => ({
  type: 'bundle',
  id: 'bundle--1',
  objects: [
    { type: 'identity', id: MITRE, name: 'The MITRE Corporation' },
    ...objectsBefore,
    ...objects,
  ],
});

describe('parseDefaultThreatsDataset', () => {
  it('should give a threat its MITRE id as STIX id, and its claims the catalogue\'s technique name and STIX id', () => {
    const phishing = techniqueStixId('T1566');
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016'),
      uses('relationship--1', 'intrusion-set--a', phishing),
    ]));

    expect(dataset.threats).toHaveLength(1);
    const [threat] = dataset.threats;
    expect(threat.threat).toMatchObject({ stixId: 'threat--G0016', mitreGroupId: 'G0016', entityType: 'intrusion-set' });
    expect(threat.aliases).toEqual(['Alias G0016']);
    expect(threat.techniques).toEqual([expect.objectContaining({
      mitreExternalId: 'T1566',
      stixId: phishing,
      name: mitreTechniquesData.find((technique) => technique.externalId === 'T1566')?.name,
      producerName: 'The MITRE Corporation',
    })]);
  });

  it('should take the ATT&CK release from the dataset release object', () => {
    expect(parseDefaultThreatsDataset(bundle([], [release('21.0')])).attackRelease).toBe('21.0');
  });

  it('should state no release when the file holds no release object', () => {
    expect(parseDefaultThreatsDataset(bundle([], [])).attackRelease).toBeNull();
  });

  it('should not take a release from a MITRE collection object', () => {
    const dataset = parseDefaultThreatsDataset(bundle([], [{ type: 'x-mitre-collection', id: 'x-mitre-collection--1', x_mitre_version: '19.0' }]));

    expect(dataset.attackRelease).toBeNull();
  });

  it('should apply its own confidence to a threat and to its claims, whatever the file states', () => {
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016', { confidence: 10 }),
      { ...uses('relationship--1', 'intrusion-set--a', techniqueStixId('T1566')), confidence: 10 },
    ]));

    expect(DEFAULT_THREATS_CONFIDENCE).toBe(80);
    expect(dataset.threats[0].threat.confidence).toBe(80);
    expect(dataset.threats[0].techniques[0].relConfidence).toBe(80);
  });

  it('should keep a description as MITRE wrote it, markdown and citations included', () => {
    const description = '[APT29](https://attack.mitre.org/groups/G0016) is a group.(Citation: Mandiant APT29 2022)\n\n<code>cmd.exe</code> is used.';
    const dataset = parseDefaultThreatsDataset(bundle([group('intrusion-set--a', 'G0016', { description })]));

    expect(dataset.threats[0].threat.description).toBe(description);
  });

  it('should ignore a claim on a technique the catalogue does not know, and count it', () => {
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016'),
      uses('relationship--1', 'intrusion-set--a', techniqueStixId('T1566')),
      uses('relationship--2', 'intrusion-set--a', 'attack-pattern--00000000-0000-4000-8000-000000000000'),
    ]));

    expect(dataset.threats[0].techniques.map((claim) => claim.mitreExternalId)).toEqual(['T1566']);
    expect(dataset.ignoredTechniqueClaims).toBe(1);
  });

  it('should not count a use whose target is no technique', () => {
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016'),
      uses('relationship--1', 'intrusion-set--a', 'malware--00000000-0000-4000-8000-000000000000'),
    ]));

    expect(dataset.threats[0].techniques).toEqual([]);
    expect(dataset.ignoredTechniqueClaims).toBe(0);
  });

  it('should load a claim on a revoked technique the catalogue keeps', () => {
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016'),
      uses('relationship--1', 'intrusion-set--a', techniqueStixId('T1562.001')),
    ]));

    expect(dataset.threats[0].techniques.map((claim) => claim.mitreExternalId)).toEqual(['T1562.001']);
  });

  it('should keep one claim when a threat uses a technique twice', () => {
    const phishing = techniqueStixId('T1566');
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016'),
      uses('relationship--1', 'intrusion-set--a', phishing),
      uses('relationship--2', 'intrusion-set--a', phishing),
    ]));

    expect(dataset.threats[0].techniques).toHaveLength(1);
  });

  it('should leave out a revoked or deprecated threat, and one without a well-formed MITRE id', () => {
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--live', 'G0001'),
      group('intrusion-set--revoked', 'G0002', { revoked: true }),
      group('intrusion-set--deprecated', 'G0003', { x_mitre_deprecated: true }),
      group('intrusion-set--malformed', 'S0001'),
      group('intrusion-set--none', 'G0004', { external_references: [] }),
    ]));

    expect(dataset.threats.map((threat) => threat.threat.stixId)).toEqual(['threat--G0001']);
  });

  it('should keep the first of two objects claiming one MITRE id', () => {
    const dataset = parseDefaultThreatsDataset(bundle([group('intrusion-set--a', 'G0001'), group('intrusion-set--b', 'G0001')]));

    expect(dataset.threats).toHaveLength(1);
  });

  it('should attribute a campaign to the group it names, by the group\'s own STIX id', () => {
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016'),
      { type: 'campaign', id: 'campaign--c', name: 'SolarWinds Compromise', first_seen: '2019-08-01T00:00:00Z', external_references: mitreRef('C0024') },
      { type: 'relationship', id: 'relationship--3', relationship_type: 'attributed-to', source_ref: 'campaign--c', target_ref: 'intrusion-set--a' },
    ]));

    const campaign = dataset.threats.find((threat) => threat.threat.entityType === 'campaign');
    expect(campaign?.threat.firstSeen).toEqual(new Date('2019-08-01T00:00:00Z'));
    expect(campaign?.attributions.map((attribution) => attribution.targetStixId)).toEqual([defaultThreatStixId('G0016')]);
  });

  it('should ignore an object type and a property it does not know', () => {
    const dataset = parseDefaultThreatsDataset(bundle([
      group('intrusion-set--a', 'G0016', { x_opencrq_future: { anything: true } }),
      { type: 'x-opencrq-something-new', id: 'x-opencrq-something-new--1' },
      { type: 'extension-definition', id: 'extension-definition--1', name: 'x-opencrq-dataset-release' },
      { type: 'marking-definition', id: 'marking-definition--1' },
      { type: 'malware', id: 'malware--1', name: 'A malware' },
    ]));

    expect(dataset.threats).toHaveLength(1);
  });

  describe('outcome assessments', () => {
    it('should give a threat the probabilities and the date of the judged assessment pointing to it, wherever it sits in the file', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        assessment('x-opencrq-outcome-assessment--1', 'intrusion-set--a', { [AttackOutcome_Espionage]: 0.97, [AttackOutcome_Ransomware]: 0 }),
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--b', 'G0017'),
      ]));

      const [judged, unjudged] = dataset.threats;
      expect(judged.judgedOutcomes).toEqual({
        judgedAt: new Date('2026-11-02T00:00:00.000Z'),
        probabilities: new Map([[AttackOutcome_Espionage, 0.97], [AttackOutcome_Ransomware, 0]]),
      });
      expect(unjudged.judgedOutcomes).toBeUndefined();
    });

    it('should keep an outcome id it does not know, for ingestion to leave out', () => {
      const unknownOutcome = '00000000-0000-4000-8000-000000000000';
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        assessment('x-opencrq-outcome-assessment--1', 'intrusion-set--a', { [AttackOutcome_Espionage]: 0.5, [unknownOutcome]: 0.2 }),
      ]));

      expect([...dataset.threats[0].judgedOutcomes?.probabilities.keys() ?? []]).toEqual([AttackOutcome_Espionage, unknownOutcome]);
    });

    it('should ignore an assessment with a probability above 1 or below 0, another method, or no date', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--b', 'G0017'),
        group('intrusion-set--c', 'G0018'),
        group('intrusion-set--d', 'G0019'),
        group('intrusion-set--e', 'G0020'),
        assessment('x-opencrq-outcome-assessment--1', 'intrusion-set--a', { [AttackOutcome_Espionage]: 0.5, [AttackOutcome_Ransomware]: 1.2 }),
        assessment('x-opencrq-outcome-assessment--2', 'intrusion-set--b', { [AttackOutcome_Espionage]: 0.5 }, { method: 'counted' }),
        assessment('x-opencrq-outcome-assessment--3', 'intrusion-set--c', { [AttackOutcome_Espionage]: 0.5 }, { modified: 'yesterday' }),
        assessment('x-opencrq-outcome-assessment--4', 'intrusion-set--d', { [AttackOutcome_Espionage]: '0.5' }),
        assessment('x-opencrq-outcome-assessment--5', 'intrusion-set--e', { [AttackOutcome_Espionage]: 0.5, [AttackOutcome_Ransomware]: -0.1 }),
      ]));

      expect(dataset.threats.map((threat) => threat.judgedOutcomes)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    });

    it('should ignore a revoked or deprecated assessment, so the one that replaces it stands', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--b', 'G0017'),
        assessment('x-opencrq-outcome-assessment--1', 'intrusion-set--a', { [AttackOutcome_Espionage]: 0.9 }, { revoked: true }),
        assessment('x-opencrq-outcome-assessment--2', 'intrusion-set--a', { [AttackOutcome_Espionage]: 0.2 }),
        assessment('x-opencrq-outcome-assessment--3', 'intrusion-set--b', { [AttackOutcome_Espionage]: 0.9 }, { x_mitre_deprecated: true }),
      ]));

      expect(dataset.threats.map((threat) => threat.judgedOutcomes?.probabilities.get(AttackOutcome_Espionage))).toEqual([0.2, undefined]);
    });

    it('should ignore an assessment pointing to no live threat of the file, and keep the first of two pointing to one', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--revoked', 'G0017', { revoked: true }),
        assessment('x-opencrq-outcome-assessment--1', 'intrusion-set--a', { [AttackOutcome_Espionage]: 0.9 }),
        assessment('x-opencrq-outcome-assessment--2', 'intrusion-set--a', { [AttackOutcome_Espionage]: 0.1 }),
        assessment('x-opencrq-outcome-assessment--3', 'intrusion-set--revoked', { [AttackOutcome_Espionage]: 0.5 }),
        assessment('x-opencrq-outcome-assessment--4', 'intrusion-set--absent', { [AttackOutcome_Espionage]: 0.5 }),
      ]));

      expect(dataset.threats).toHaveLength(1);
      expect(dataset.threats[0].judgedOutcomes?.probabilities.get(AttackOutcome_Espionage)).toBe(0.9);
    });
  });

  describe('actor class assessments', () => {
    it('should give a group its judged class and a campaign the class of its group, wherever they sit in the file', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        classAssessment('x-opencrq-actor-class-assessment--1', 'intrusion-set--a', 'state_sponsored'),
        classAssessment('x-opencrq-actor-class-assessment--2', 'campaign--c', 'state_sponsored', { method: 'attributed-group' }),
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--b', 'G0017'),
        { type: 'campaign', id: 'campaign--c', name: 'Campaign C0001', external_references: mitreRef('C0001') },
      ]));

      expect(dataset.threats.map((threat) => threat.statedActorClass)).toEqual(['state_sponsored', undefined, 'state_sponsored']);
    });

    it('should read a class it does not know as the default class, and ignore an assessment stating none', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--b', 'G0017'),
        classAssessment('x-opencrq-actor-class-assessment--1', 'intrusion-set--a', 'insider'),
        classAssessment('x-opencrq-actor-class-assessment--2', 'intrusion-set--b', undefined),
      ]));

      expect(dataset.threats.map((threat) => threat.statedActorClass)).toEqual(['default', undefined]);
    });

    it('should take either method on a group or a campaign alike', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        { type: 'campaign', id: 'campaign--c', name: 'Campaign C0001', external_references: mitreRef('C0001') },
        classAssessment('x-opencrq-actor-class-assessment--1', 'intrusion-set--a', 'hacktivist', { method: 'attributed-group' }),
        classAssessment('x-opencrq-actor-class-assessment--2', 'campaign--c', 'ransomware_operator'),
      ]));

      expect(dataset.threats.map((threat) => threat.statedActorClass)).toEqual(['hacktivist', 'ransomware_operator']);
    });

    it('should ignore an assessment of another method, or of none', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--b', 'G0017'),
        classAssessment('x-opencrq-actor-class-assessment--1', 'intrusion-set--a', 'state_sponsored', { method: 'inferred' }),
        classAssessment('x-opencrq-actor-class-assessment--2', 'intrusion-set--b', 'state_sponsored', { method: undefined }),
      ]));

      expect(dataset.threats.map((threat) => threat.statedActorClass)).toEqual([undefined, undefined]);
    });

    it('should ignore a revoked assessment and one pointing to no live threat of the file, and keep the first of two pointing to one', () => {
      const dataset = parseDefaultThreatsDataset(bundle([
        group('intrusion-set--a', 'G0016'),
        group('intrusion-set--revoked', 'G0017', { revoked: true }),
        classAssessment('x-opencrq-actor-class-assessment--1', 'intrusion-set--a', 'hacktivist', { revoked: true }),
        classAssessment('x-opencrq-actor-class-assessment--2', 'intrusion-set--a', 'ransomware_operator'),
        classAssessment('x-opencrq-actor-class-assessment--3', 'intrusion-set--a', 'opportunistic_crime'),
        classAssessment('x-opencrq-actor-class-assessment--4', 'intrusion-set--revoked', 'state_sponsored'),
        classAssessment('x-opencrq-actor-class-assessment--5', 'intrusion-set--absent', 'state_sponsored'),
      ]));

      expect(dataset.threats.map((threat) => threat.statedActorClass)).toEqual(['ransomware_operator']);
    });
  });

  it('should refuse a file that is not a STIX bundle', () => {
    expect(() => parseDefaultThreatsDataset({ hello: 'world' })).toThrow();
    expect(() => parseDefaultThreatsDataset([])).toThrow();
  });
});
