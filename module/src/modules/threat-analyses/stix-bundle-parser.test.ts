import { describe, expect, it } from 'vitest';
import type { ParsedTechnique } from './stix-bundle-parser';
import { NonRetryableError } from '../jobs/types';
import { dedupeAliases } from './aliases';
import {
  buildStixGraph,
  buildThreatEntriesFromObjects,
  isRelevantStixObject,
  parseThreatBundle,
  trimRelevantStixObject,
} from './stix-bundle-parser';
import apt17ArsenalBundle from './__fixtures__/apt17-arsenal-bundle.json';
import renumberedAttackPatternBundle from './__fixtures__/renumbered-attack-pattern.json';
import saltTyphoonBundle from './__fixtures__/salt-typhoon-bundle.json';

const OPENCTI_EXTENSION_ID = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';
const MITRE_EXTENSION_ID = 'extension-definition--322b8f77-262a-4cb8-a915-1e441e00329b';

describe('parseThreatBundle', () => {
  const sortByRelationId = (techniques: Array<ParsedTechnique>): Array<ParsedTechnique> =>
    [...techniques].sort((a, b) => a.stixRelationId.localeCompare(b.stixRelationId));

  describe('with the Salt Typhoon bundle', () => {
    const [parsed] = parseThreatBundle(saltTyphoonBundle);

    it('returns a single intrusion-set entry', () => {
      const result = parseThreatBundle(saltTyphoonBundle);
      expect(result).toHaveLength(1);
    });

    it('extracts the intrusion-set core fields', () => {
      expect(parsed.threat).toMatchObject({
        stixId: 'intrusion-set--bd7939b6-ac23-51f0-a699-9843951baa8a',
        name: 'Salt Typhoon',
        mitreGroupId: 'G1045',
        confidence: 80,
        firstSeen: null,
        lastSeen: null,
        primaryMotivation: null,
        resourceLevel: null,
      });
      expect(parsed.threat.stixCreated).toEqual(new Date('2025-02-24T20:45:14.093Z'));
      expect(parsed.threat.description).toContain('Salt Typhoon');
    });

    it('keeps only the targeted locations that resolve to a country', () => {
      // 18 `targets` relationships point at a location; 9 of those locations are regions or
      // continents carrying no `country` and matching no asset location.
      expect(parsed.locations).toHaveLength(9);
      expect(parsed.locations.every((l) => l.country !== null)).toBe(true);
    });

    it('drops a region-level location that carries no country', () => {
      expect(parsed.locations.find((l) => l.name === 'Northern America')).toBeUndefined();
    });

    it('extracts all targeted sectors (class-level identities)', () => {
      expect(parsed.sectors).toHaveLength(5);
      expect(parsed.sectors.map((s) => s.name)).toEqual(
        expect.arrayContaining(['Technologies', 'Government and administrations', 'Defense', 'Energy', 'Telecommunications']),
      );
    });

    it('does not mistake a producer organization for a sector', () => {
      expect(parsed.sectors.map((s) => s.stixId)).not.toContain('identity--e52b2fa3-2af0-5e53-ad38-17d54b3d61cb');
    });

    it('extracts all targeted CVEs', () => {
      expect(parsed.cves).toHaveLength(10);
      expect(parsed.cves.map((c) => c.cveId)).toContain('CVE-2024-3400');
      expect(parsed.cves.every((c) => c.cveId.startsWith('CVE-'))).toBe(true);
    });

    it('emits one technique claim per relationship, not per attack-pattern', () => {
      // 95 `uses` relationships pointing at 83 distinct attack-patterns: the 12 attack-patterns
      // described twice are two claims each, not one elected row.
      expect(parsed.techniques).toHaveLength(95);
      expect(new Set(parsed.techniques.map((t) => t.stixId)).size).toBe(83);
      expect(new Set(parsed.techniques.map((t) => t.stixRelationId)).size).toBe(95);
    });

    it('keeps both relationships describing the same technique, each with its own provenance', () => {
      const claims = parsed.techniques.filter((t) => t.name === 'Indicator Removal');
      expect(claims.map((t) => t.stixRelationId).sort()).toEqual([
        'relationship--09ef62de-55d0-5749-8abf-c46014402ef3',
        'relationship--edb927a7-f32a-5159-b67b-7acc4e37ac4c',
      ]);
      expect(claims.map((t) => t.relConfidence).sort((first, second) => (first ?? 0) - (second ?? 0))).toEqual([50, 100]);
    });

    it('re-parsing the same bundle produces identical claim rows', () => {
      expect(parseThreatBundle(saltTyphoonBundle)[0].techniques).toEqual(parsed.techniques);
    });

    it('keeps every distinct activity day carried by the raw relationships', () => {
      const utcDays = (dates: Array<Date | null>) =>
        [...new Set(dates.filter((date): date is Date => date !== null).map((date) => date.toISOString().slice(0, 10)))].sort();

      const rawUsesAnchors = (saltTyphoonBundle.objects as Array<Record<string, unknown>>)
        .filter((obj) => obj['type'] === 'relationship' && obj['relationship_type'] === 'uses')
        .filter((rel) => String(rel['target_ref']).startsWith('attack-pattern--'))
        .map((rel) => new Date(String(rel['stop_time'] ?? rel['start_time'] ?? rel['created'])));

      expect(rawUsesAnchors).toHaveLength(95);
      expect(utcDays(parsed.techniques.map((t) => t.relStopTime ?? t.relStartTime ?? t.relCreated)))
        .toEqual(utcDays(rawUsesAnchors));
    });

    it('returns no alias (this OpenCTI export carries neither aliases nor x_opencti_aliases)', () => {
      expect(parsed.aliases).toEqual([]);
    });

    it('extracts relation dates, confidence and provenance for a location', () => {
      const germany = parsed.locations.find((l) => l.name === 'Germany');
      expect(germany).toMatchObject({
        country: 'Germany',
        relStartTime: null,
        relStopTime: null,
        relConfidence: 50,
        stixRelationId: 'relationship--1f98b5ba-3427-5ac2-9666-bf90c69651e7',
        producerStixId: 'identity--e52b2fa3-2af0-5e53-ad38-17d54b3d61cb',
        producerName: '*** Redacted ***',
        isInferred: false,
      });
      expect(germany?.relCreated).toEqual(new Date('2025-07-24T10:18:52.971Z'));
      expect(germany?.relModified).toEqual(new Date('2025-07-24T14:28:04.301Z'));
    });

    it('leaves the producer empty on a relationship that names none', () => {
      const unattributed = parsed.techniques.find((t) => t.stixRelationId === 'relationship--edb927a7-f32a-5159-b67b-7acc4e37ac4c');
      expect(unattributed).toMatchObject({ producerStixId: null, producerName: null });
    });

    it('extracts relation dates and confidence for a CVE', () => {
      const cve = parsed.cves.find((c) => c.cveId === 'CVE-2024-3400');
      expect(cve).toMatchObject({
        relStartTime: null,
        relStopTime: null,
        relConfidence: 50,
      });
      expect(cve?.relCreated).toEqual(new Date('2025-08-28T15:05:01.129Z'));
      expect(cve?.relModified).toEqual(new Date('2025-08-28T15:05:49.458Z'));
    });

    it('extracts the MITRE external id for a technique', () => {
      const technique = parsed.techniques.find((t) => t.mitreExternalId === 'T1068');
      expect(technique).toBeDefined();
      expect(technique?.name).toBeTruthy();
    });
  });

  // Real MITRE ATT&CK STIX 2.1 export (verbatim objects from `attack-stix-data`), trimmed to one
  // group and its arsenal. The Salt Typhoon export carries no alias on the intrusion-set and
  // resolves every producer it names, so both headline behaviours would otherwise only be
  // exercised by hand-built bundles whose field shapes are the ones the author assumed.
  describe('with the APT17 arsenal export (real ATT&CK objects)', () => {
    const [parsed] = parseThreatBundle(apt17ArsenalBundle);

    it('extracts the aliases carried by the real export', () => {
      expect(parsed.threat.name).toBe('APT17');
      expect(parsed.threat.mitreGroupId).toBe('G0025');
      expect(parsed.aliases).toEqual(['APT17', 'Deputy Dog']);
    });

    it('keeps only the techniques the group states itself, ignoring its malware arsenal', () => {
      expect(parsed.techniques.map((t) => t.mitreExternalId).sort()).toEqual(['T1583.006', 'T1585']);
    });

    it('keeps an unresolvable producer id with an empty name', () => {
      // The export references the ATT&CK identity without carrying the object itself.
      expect(parsed.techniques.every((t) => t.producerStixId === 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5')).toBe(true);
      expect(parsed.techniques.every((t) => t.producerName === null)).toBe(true);
    });

    it('leaves isInferred false on a plain ATT&CK export', () => {
      expect(parsed.techniques.every((t) => t.isInferred === false)).toBe(true);
    });

    it('produces the same result whatever the order of the bundle objects', () => {
      const [reversed] = parseThreatBundle({
        ...apt17ArsenalBundle,
        objects: [...apt17ArsenalBundle.objects].reverse(),
      });
      expect(sortByRelationId(reversed.techniques)).toEqual(sortByRelationId(parsed.techniques));
    });
  });

  describe('MITRE id resolution', () => {
    describe('with the renumbered attack-pattern export (real platform objects)', () => {
      const [parsed] = parseThreatBundle(renumberedAttackPatternBundle);

      it('reads the renumbered technique under its current id, not the retired one it still carries', () => {
        const claim = parsed.techniques.find((t) => t.stixId === 'attack-pattern--8180a360-cca4-5911-850e-07d17893cbf8');
        expect(claim?.mitreExternalId).toBe('T1566.001');
      });

      it('reads a technique that was never renumbered under its only id', () => {
        const claim = parsed.techniques.find((t) => t.stixId === 'attack-pattern--e08fc04a-2ef7-5f05-b788-a4f8b6c340ed');
        expect(claim?.mitreExternalId).toBe('T1534');
      });

      it('reads the group id of an intrusion set, which carries no MITRE extension', () => {
        expect(parsed.threat.mitreGroupId).toBe('G0007');
      });
    });

    const buildTechniqueBundle = (attackPattern: Record<string, unknown>) => ({
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000018',
      objects: [
        { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
        { type: 'attack-pattern', id: 'attack-pattern--ap', name: 'AP', ...attackPattern },
        {
          type: 'relationship', id: 'relationship--r1', relationship_type: 'uses',
          source_ref: 'intrusion-set--g', target_ref: 'attack-pattern--ap',
        },
      ],
    });

    const contradictingReferences = [
      { source_name: 'mitre-attack', external_id: 'T1193', url: 'https://attack.mitre.org/techniques/T1193' },
      { source_name: 'mitre-attack', external_id: 'T1566.001', url: 'https://attack.mitre.org/techniques/T1566/001' },
    ];

    it('prefers the id the MITRE extension states over any external reference', () => {
      const [parsed] = parseThreatBundle(buildTechniqueBundle({
        extensions: { [MITRE_EXTENSION_ID]: { extension_type: 'property-extension', id: 'T1566.001' } },
        external_references: contradictingReferences,
      }));

      expect(parsed.techniques.map((t) => t.mitreExternalId)).toEqual(['T1566.001']);
    });

    it('prefers the top-level x_mitre_id of a simple export over any external reference', () => {
      const [parsed] = parseThreatBundle(buildTechniqueBundle({
        x_mitre_id: 'T1566.001',
        external_references: contradictingReferences,
      }));

      expect(parsed.techniques.map((t) => t.mitreExternalId)).toEqual(['T1566.001']);
    });

    it('falls back to the reference whose url states its own id', () => {
      const [parsed] = parseThreatBundle(buildTechniqueBundle({
        external_references: [
          { source_name: 'mitre-attack', external_id: 'T1193', url: 'https://attack.mitre.org/techniques/T1566/001' },
          { source_name: 'mitre-attack', external_id: 'T1566.001', url: 'https://attack.mitre.org/techniques/T1566/001' },
        ],
      }));

      expect(parsed.techniques.map((t) => t.mitreExternalId)).toEqual(['T1566.001']);
    });

    it('falls back to the first reference when none carries a url', () => {
      const [parsed] = parseThreatBundle(buildTechniqueBundle({
        external_references: [
          { source_name: 'mitre-attack', external_id: 'T1193' },
          { source_name: 'mitre-attack', external_id: 'T1566.001' },
        ],
      }));

      expect(parsed.techniques.map((t) => t.mitreExternalId)).toEqual(['T1193']);
    });

    it('accepts the dotted spelling of a sub-technique in a reference url', () => {
      const [parsed] = parseThreatBundle(buildTechniqueBundle({
        external_references: [
          { source_name: 'mitre-attack', external_id: 'T1193', url: 'https://example.test/whatever' },
          { source_name: 'mitre-attack', external_id: 'T1566.001', url: 'https://attack.mitre.org/techniques/T1566.001' },
        ],
      }));

      expect(parsed.techniques.map((t) => t.mitreExternalId)).toEqual(['T1566.001']);
    });

    const buildGroupBundle = (threat: Record<string, unknown>) => ({
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000019',
      objects: [{ type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G', ...threat }],
    });

    it('resolves the group id in the same order as a technique id', () => {
      const references = [
        { source_name: 'mitre-attack', external_id: 'G9999', url: 'https://example.test/whatever' },
        { source_name: 'mitre-attack', external_id: 'G0007', url: 'https://attack.mitre.org/groups/G0007' },
      ];

      expect(parseThreatBundle(buildGroupBundle({
        x_mitre_id: 'G0100',
        external_references: references,
      }))[0]?.threat.mitreGroupId).toBe('G0100');
      expect(parseThreatBundle(buildGroupBundle({ external_references: references }))[0]?.threat.mitreGroupId).toBe('G0007');
      expect(parseThreatBundle(buildGroupBundle({
        external_references: references.map(({ source_name, external_id }) => ({ source_name, external_id })),
      }))[0]?.threat.mitreGroupId).toBe('G9999');
    });

    it('leaves the group id null when no MITRE source states one', () => {
      const [parsed] = parseThreatBundle(buildGroupBundle({
        external_references: [{ source_name: 'capec', external_id: 'CAPEC-163', url: 'https://capec.mitre.org/data/definitions/163.html' }],
      }));

      expect(parsed.threat.mitreGroupId).toBeNull();
    });
  });

  describe('aliases', () => {
    const buildAliasBundle = (threat: Record<string, unknown>) => ({
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000002',
      objects: [{ type: 'intrusion-set', id: 'intrusion-set--a', name: 'Group A', ...threat }],
    });

    it('extracts the STIX aliases', () => {
      const [parsed] = parseThreatBundle(buildAliasBundle({ aliases: ['GhostEmperor', 'Earth Estries'] }));
      expect(parsed.aliases).toEqual(['GhostEmperor', 'Earth Estries']);
    });

    it('extracts the OpenCTI-specific aliases', () => {
      const [parsed] = parseThreatBundle(buildAliasBundle({ x_opencti_aliases: ['UNC2286'] }));
      expect(parsed.aliases).toEqual(['UNC2286']);
    });

    it('merges both alias fields and trims them, leaving the dedup to the module normalizer', () => {
      const [parsed] = parseThreatBundle(buildAliasBundle({
        aliases: ['GhostEmperor', '  Earth Estries  ', 'GhostEmperor'],
        x_opencti_aliases: ['ghostemperor', 'UNC2286'],
      }));
      expect(parsed.aliases).toEqual(['GhostEmperor', 'Earth Estries', 'GhostEmperor', 'ghostemperor', 'UNC2286']);
    });

    it('produces aliases the service normalizer reduces to the unique-index key set', () => {
      // Pins the contract between the two workspaces: whatever the parser emits, `dedupeAliases`
      // (the enforcement point for the `(analysis_id, lower(alias))` unique index) accepts it and
      // returns one entry per case-folded alias.
      const bundles = [
        buildAliasBundle({ aliases: ['GhostEmperor', '  Earth Estries  ', 'GhostEmperor'], x_opencti_aliases: ['ghostemperor', 'UNC2286'] }),
        buildAliasBundle({ aliases: ['', '   ', 'Real Alias'] }),
        apt17ArsenalBundle,
        saltTyphoonBundle,
      ];
      for (const bundle of bundles) {
        for (const entry of parseThreatBundle(bundle)) {
          const deduped = dedupeAliases(entry.aliases);
          expect(new Set(deduped.map((alias) => alias.toLowerCase())).size).toBe(deduped.length);
          expect(deduped.every((alias) => alias.trim() === alias && alias.length > 0)).toBe(true);
          expect(new Set(deduped.map((alias) => alias.toLowerCase())))
            .toEqual(new Set(entry.aliases.map((alias) => alias.toLowerCase())));
        }
      }
    });

    it('ignores empty strings, non-string entries and non-array alias fields', () => {
      const [parsed] = parseThreatBundle(buildAliasBundle({
        aliases: ['', '   ', 42, null, 'Real Alias'],
        x_opencti_aliases: 'not-an-array',
      }));
      expect(parsed.aliases).toEqual(['Real Alias']);
    });

    it('returns an empty array when the intrusion-set carries no alias field', () => {
      const [parsed] = parseThreatBundle(buildAliasBundle({}));
      expect(parsed.aliases).toEqual([]);
    });

    it('drops an alias over the indexed-value length instead of aborting the bundle', () => {
      const [parsed] = parseThreatBundle(buildAliasBundle({
        aliases: ['a'.repeat(512), 'a'.repeat(513), 'Real Alias'],
      }));
      expect(parsed.aliases).toEqual(['a'.repeat(512), 'Real Alias']);
    });
  });

  describe('labels', () => {
    const buildLabelBundle = (threat: Record<string, unknown>) => ({
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000003',
      objects: [{ type: 'intrusion-set', id: 'intrusion-set--l', name: 'Group L', ...threat }],
    });

    it('extracts the STIX labels trimmed, dropping empty and non-string entries', () => {
      const [parsed] = parseThreatBundle(buildLabelBundle({
        labels: ['ransomware', '  state-sponsored  ', '', 42, null],
      }));
      expect(parsed.threat.labels).toEqual(['ransomware', 'state-sponsored']);
    });

    it('returns an empty array when the intrusion-set carries no label field', () => {
      const [parsed] = parseThreatBundle(buildLabelBundle({}));
      expect(parsed.threat.labels).toEqual([]);
    });
  });

  describe('secondary motivations and goals', () => {
    const buildBundle = (threat: Record<string, unknown>) => ({
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000004',
      objects: [{ type: 'intrusion-set', id: 'intrusion-set--a', name: 'Group A', ...threat }],
    });

    it('extracts secondary_motivations and goals as STIX list-of-string properties', () => {
      const [parsed] = parseThreatBundle(buildBundle({
        secondary_motivations: ['ideology', 'notoriety'],
        goals: ['Disrupt critical infrastructure'],
      }));
      expect(parsed.secondaryMotivations).toEqual(['ideology', 'notoriety']);
      expect(parsed.goals).toEqual(['Disrupt critical infrastructure']);
    });

    it('trims surrounding whitespace but changes nothing else', () => {
      const [parsed] = parseThreatBundle(buildBundle({
        secondary_motivations: ['  Organizational-Gain  '],
        goals: ['  Steal intellectual property  '],
      }));
      expect(parsed.secondaryMotivations).toEqual(['Organizational-Gain']);
      expect(parsed.goals).toEqual(['Steal intellectual property']);
    });

    it('ignores empty strings, non-string entries and non-array fields', () => {
      const [parsed] = parseThreatBundle(buildBundle({
        secondary_motivations: ['', '   ', 42, null, 'espionage'],
        goals: 'not-an-array',
      }));
      expect(parsed.secondaryMotivations).toEqual(['espionage']);
      expect(parsed.goals).toEqual([]);
    });

    it('returns empty arrays when the intrusion-set carries neither field', () => {
      const [parsed] = parseThreatBundle(buildBundle({}));
      expect(parsed.secondaryMotivations).toEqual([]);
      expect(parsed.goals).toEqual([]);
    });

    it('drops a value over the indexed-value length instead of aborting the bundle', () => {
      const [parsed] = parseThreatBundle(buildBundle({
        secondary_motivations: ['a'.repeat(513), 'ideology'],
        goals: ['b'.repeat(513)],
      }));
      expect(parsed.secondaryMotivations).toEqual(['ideology']);
      expect(parsed.goals).toEqual([]);
    });
  });

  describe('one claim per relationship', () => {
    const targets = (id: string, target: string, created: string, confidence: number) => ({
      type: 'relationship',
      id,
      relationship_type: 'targets',
      source_ref: 'intrusion-set--g',
      target_ref: target,
      created,
      confidence,
    });

    const bundle = {
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000007',
      objects: [
        { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
        { type: 'location', id: 'location--fr', name: 'France', country: 'France' },
        { type: 'identity', id: 'identity--defense', name: 'Defense', identity_class: 'class' },
        { type: 'vulnerability', id: 'vulnerability--log4j', name: 'CVE-2021-44228' },
        targets('relationship--fr-old', 'location--fr', '2024-01-01T00:00:00.000Z', 50),
        targets('relationship--fr-new', 'location--fr', '2025-06-01T00:00:00.000Z', 90),
        targets('relationship--defense-new', 'identity--defense', '2025-06-01T00:00:00.000Z', 90),
        targets('relationship--defense-old', 'identity--defense', '2024-01-01T00:00:00.000Z', 50),
        targets('relationship--log4j-old', 'vulnerability--log4j', '2024-01-01T00:00:00.000Z', 50),
        targets('relationship--log4j-new', 'vulnerability--log4j', '2025-06-01T00:00:00.000Z', 90),
      ],
    };

    it('keeps every relationship targeting the same location, sector or CVE as its own claim', () => {
      const [parsed] = parseThreatBundle(bundle);

      expect(parsed.locations).toHaveLength(2);
      expect(parsed.sectors).toHaveLength(2);
      expect(parsed.cves).toHaveLength(2);
      for (const rows of [parsed.locations, parsed.sectors, parsed.cves]) {
        expect([...rows].map((row) => row.relConfidence).sort()).toEqual([50, 90]);
        expect(new Set(rows.map((row) => row.stixRelationId)).size).toBe(2);
      }
    });

    it('drops a relationship that carries no STIX id rather than synthesising a key for it', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000013',
        objects: [
          { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
          { type: 'location', id: 'location--fr', name: 'France', country: 'France' },
          {
            type: 'relationship', relationship_type: 'targets',
            source_ref: 'intrusion-set--g', target_ref: 'location--fr',
          },
        ],
      });

      expect(parsed.locations).toEqual([]);
    });

    it('collapses two copies of the same relationship id into one claim', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000014',
        objects: [
          { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
          { type: 'location', id: 'location--fr', name: 'France', country: 'France' },
          targets('relationship--fr', 'location--fr', '2024-01-01T00:00:00.000Z', 50),
          targets('relationship--fr', 'location--fr', '2024-01-01T00:00:00.000Z', 50),
        ],
      });

      expect(parsed.locations).toHaveLength(1);
    });
  });

  describe('claim provenance', () => {
    const buildBundle = (relationship: Record<string, unknown>) => ({
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000015',
      objects: [
        { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
        { type: 'location', id: 'location--fr', name: 'France', country: 'France' },
        { type: 'identity', id: 'identity--producer', name: 'Acme CTI', identity_class: 'organization' },
        {
          type: 'relationship',
          id: 'relationship--r1',
          relationship_type: 'targets',
          source_ref: 'intrusion-set--g',
          target_ref: 'location--fr',
          ...relationship,
        },
      ],
    });

    const parseLocation = (relationship: Record<string, unknown>) =>
      parseThreatBundle(buildBundle(relationship))[0].locations[0];

    it('resolves the producer name from the identity carried by the bundle', () => {
      expect(parseLocation({ created_by_ref: 'identity--producer' })).toMatchObject({
        producerStixId: 'identity--producer',
        producerName: 'Acme CTI',
      });
    });

    it('keeps an unresolvable producer id with an empty name', () => {
      expect(parseLocation({ created_by_ref: 'identity--absent' })).toMatchObject({
        producerStixId: 'identity--absent',
        producerName: null,
      });
    });

    it('flags an inferred relationship from the OpenCTI extension', () => {
      expect(parseLocation({ extensions: { [OPENCTI_EXTENSION_ID]: { is_inferred: true } } }).isInferred).toBe(true);
    });

    it('defaults isInferred to false when the extension is absent or silent', () => {
      expect(parseLocation({}).isInferred).toBe(false);
      expect(parseLocation({ extensions: { [OPENCTI_EXTENSION_ID]: {} } }).isInferred).toBe(false);
    });
  });

  describe('unusable claims', () => {
    it('drops a technique whose attack-pattern carries no MITRE external id', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000016',
        objects: [
          { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
          { type: 'attack-pattern', id: 'attack-pattern--unmapped', name: 'Unmapped' },
          {
            type: 'attack-pattern',
            id: 'attack-pattern--mapped',
            name: 'Mapped',
            external_references: [{ source_name: 'mitre-attack', external_id: 'T1001' }],
          },
          {
            type: 'relationship', id: 'relationship--unmapped', relationship_type: 'uses',
            source_ref: 'intrusion-set--g', target_ref: 'attack-pattern--unmapped',
          },
          {
            type: 'relationship', id: 'relationship--mapped', relationship_type: 'uses',
            source_ref: 'intrusion-set--g', target_ref: 'attack-pattern--mapped',
          },
        ],
      });

      expect(parsed.techniques.map((t) => t.mitreExternalId)).toEqual(['T1001']);
    });

    it('ignores the techniques reachable only through a malware the group uses', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000017',
        objects: [
          { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
          { type: 'malware', id: 'malware--m1', name: 'Malware One' },
          {
            type: 'attack-pattern',
            id: 'attack-pattern--ap1',
            name: 'AP1',
            external_references: [{ source_name: 'mitre-attack', external_id: 'T1001' }],
          },
          {
            type: 'relationship', id: 'relationship--group-malware', relationship_type: 'uses',
            source_ref: 'intrusion-set--g', target_ref: 'malware--m1',
          },
          {
            type: 'relationship', id: 'relationship--malware-ap', relationship_type: 'uses',
            source_ref: 'malware--m1', target_ref: 'attack-pattern--ap1',
          },
        ],
      });

      expect(parsed.techniques).toEqual([]);
    });
  });

  describe('threat actors and campaigns', () => {
    const country = { type: 'location', id: 'location--fr', name: 'France', country: 'France' };
    const sector = { type: 'identity', id: 'identity--energy', name: 'Energy', identity_class: 'class' };
    const technique = (externalId: string) => ({
      type: 'attack-pattern',
      id: `attack-pattern--${externalId}`,
      name: externalId,
      external_references: [{ source_name: 'mitre-attack', external_id: externalId }],
    });
    const relationship = (id: string, relationshipType: string, sourceRef: string, targetRef: string) => ({
      type: 'relationship', id: `relationship--${id}`, relationship_type: relationshipType, source_ref: sourceRef, target_ref: targetRef,
    });

    it('reads a threat actor with its targets and techniques, typed as a threat actor', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000030',
        objects: [
          { type: 'threat-actor', id: 'threat-actor--ta', name: 'Actor TA' },
          country, sector, technique('T1001'), technique('T1002'),
          relationship('ta-fr', 'targets', 'threat-actor--ta', 'location--fr'),
          relationship('ta-energy', 'targets', 'threat-actor--ta', 'identity--energy'),
          relationship('ta-t1', 'uses', 'threat-actor--ta', 'attack-pattern--T1001'),
          relationship('ta-t2', 'uses', 'threat-actor--ta', 'attack-pattern--T1002'),
        ],
      });

      expect(parsed.threat.entityType).toBe('threat-actor');
      expect(parsed.locations.map((l) => l.country)).toEqual(['France']);
      expect(parsed.sectors.map((s) => s.name)).toEqual(['Energy']);
      expect(parsed.techniques.map((t) => t.mitreExternalId)).toEqual(['T1001', 'T1002']);
    });

    it('reads the sophistication, types and roles a threat actor states', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000031',
        objects: [{
          type: 'threat-actor',
          id: 'threat-actor--ta',
          name: 'Actor TA',
          sophistication: 'expert',
          threat_actor_types: ['crime-syndicate', 'hacker'],
          roles: ['agent'],
        }],
      });

      expect(parsed.threat.sophistication).toBe('expert');
      expect(parsed.threatActorTypes).toEqual(['crime-syndicate', 'hacker']);
      expect(parsed.roles).toEqual(['agent']);
    });

    it('reads an individual exported by OpenCTI as a plain threat actor and keeps none of its personal fields', () => {
      const individual = {
        type: 'threat-actor',
        id: 'threat-actor--individual',
        name: 'Individual I',
        date_of_birth: '1990-01-01',
        gender: 'male',
        job_title: 'Operator',
        eye_color: 'brown',
        hair_color: 'black',
        height: [{ measure: 180 }],
        weight: [{ measure: 80 }],
        extensions: {
          'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba': { type: 'Threat-Actor-Individual', date_of_birth: '1990-01-01' },
        },
      };

      const [parsed] = parseThreatBundle({ type: 'bundle', id: 'bundle--00000000-0000-0000-0000-000000000032', objects: [individual] });

      expect(parsed.threat.entityType).toBe('threat-actor');
      const stored = JSON.stringify(parsed);
      for (const personal of ['1990-01-01', 'male', 'Operator', 'brown', 'black', '180']) {
        expect(stored).not.toContain(personal);
      }
    });

    it('reads a campaign with its dates, objective and targeted sector', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000033',
        objects: [
          {
            type: 'campaign',
            id: 'campaign--c',
            name: 'Campaign C',
            objective: 'Disrupt the grid',
            first_seen: '2026-07-01T00:00:00.000Z',
            last_seen: '2026-07-31T00:00:00.000Z',
          },
          sector,
          relationship('c-energy', 'targets', 'campaign--c', 'identity--energy'),
        ],
      });

      expect(parsed.threat).toMatchObject({
        entityType: 'campaign',
        objective: 'Disrupt the grid',
        firstSeen: new Date('2026-07-01T00:00:00.000Z'),
        lastSeen: new Date('2026-07-31T00:00:00.000Z'),
      });
      expect(parsed.sectors.map((s) => s.name)).toEqual(['Energy']);
    });

    it('keeps every attribution toward a threat, including one whose target the bundle does not carry', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000034',
        objects: [
          { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
          { type: 'threat-actor', id: 'threat-actor--ta', name: 'Actor TA' },
          relationship('g-ta', 'attributed-to', 'intrusion-set--g', 'threat-actor--ta'),
          relationship('g-absent', 'attributed-to', 'intrusion-set--g', 'threat-actor--absent'),
        ],
      });

      expect(parsed.attributions.map((a) => a.targetStixId)).toEqual(['threat-actor--ta', 'threat-actor--absent']);
      expect(parsed.attributions[0]).toMatchObject({ stixRelationId: 'relationship--g-ta' });
    });

    it('ignores an attribution toward something that is not a threat', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000035',
        objects: [
          { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' },
          relationship('g-identity', 'attributed-to', 'intrusion-set--g', 'identity--someone'),
        ],
      });

      expect(parsed.attributions).toEqual([]);
    });

    it('ignores a uses toward a malware and an originates-from toward a country', () => {
      const [parsed] = parseThreatBundle({
        type: 'bundle',
        id: 'bundle--00000000-0000-0000-0000-000000000036',
        objects: [
          { type: 'threat-actor', id: 'threat-actor--ta', name: 'Actor TA' },
          { type: 'malware', id: 'malware--m', name: 'Malware M' },
          country,
          relationship('ta-m', 'uses', 'threat-actor--ta', 'malware--m'),
          relationship('ta-origin', 'originates-from', 'threat-actor--ta', 'location--fr'),
        ],
      });

      expect(parsed).toMatchObject({ techniques: [], locations: [], sectors: [], cves: [], attributions: [] });
    });
  });

  it('returns an empty array for a valid bundle without any intrusion-set', () => {
    const bundle = {
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000000',
      objects: [
        { type: 'identity', id: 'identity--1', name: 'Some Org', identity_class: 'organization' },
      ],
    };

    expect(parseThreatBundle(bundle)).toEqual([]);
  });

  it('returns one entry per intrusion-set when a bundle contains several', () => {
    const bundle = {
      type: 'bundle',
      id: 'bundle--00000000-0000-0000-0000-000000000001',
      objects: [
        { type: 'intrusion-set', id: 'intrusion-set--a', name: 'Group A' },
        { type: 'intrusion-set', id: 'intrusion-set--b', name: 'Group B' },
      ],
    };

    const result = parseThreatBundle(bundle);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.threat.name)).toEqual(['Group A', 'Group B']);
  });

  it('throws a NonRetryableError when the bundle type is not "bundle"', () => {
    expect(() => parseThreatBundle({ type: 'not-a-bundle', objects: [] })).toThrow(NonRetryableError);
  });

  it('throws a NonRetryableError when the bundle has no objects array', () => {
    expect(() => parseThreatBundle({ type: 'bundle' })).toThrow(NonRetryableError);
  });

  it('throws a NonRetryableError for a completely invalid input', () => {
    expect(() => parseThreatBundle(null)).toThrow(NonRetryableError);
    expect(() => parseThreatBundle('not a bundle')).toThrow(NonRetryableError);
  });
});

describe('isRelevantStixObject (the Live Stream mirror)', () => {
  // Real fixture objects, one per distinct STIX type/shape the parser recognizes, so this test
  // can't silently drift from `parseThreatBundle` itself.
  const realObjects = [
    ...(saltTyphoonBundle.objects as Array<Record<string, unknown>>),
    ...(apt17ArsenalBundle.objects as Array<Record<string, unknown>>),
  ];
  const findByType = (type: string, extra?: (obj: Record<string, unknown>) => boolean) =>
    realObjects.find((obj) => obj['type'] === type && (!extra || extra(obj)));

  it.each([
    ['intrusion-set', () => findByType('intrusion-set')],
    ['location', () => findByType('location')],
    ['sector identity (identity_class "class")', () => findByType('identity', (obj) => obj['identity_class'] === 'class')],
    ['producer identity (identity_class "organization")', () => findByType('identity', (obj) => obj['identity_class'] === 'organization')],
    ['vulnerability', () => findByType('vulnerability')],
    ['attack-pattern', () => findByType('attack-pattern')],
    ['targets relationship', () => findByType('relationship', (obj) => obj['relationship_type'] === 'targets')],
    ['uses relationship', () => findByType('relationship', (obj) => obj['relationship_type'] === 'uses')],
  ] as const)('accepts a real %s object from the fixtures', (_label, getObject) => {
    const obj = getObject();
    expect(obj).toBeDefined();
    expect(isRelevantStixObject(obj!)).toBe(true);
  });

  it('rejects an identity that is neither a sector nor a producer organization', () => {
    expect(isRelevantStixObject({ type: 'identity', id: 'identity--1', identity_class: 'individual' })).toBe(false);
    expect(isRelevantStixObject({ type: 'identity', id: 'identity--2', identity_class: 'system' })).toBe(false);
  });

  it('accepts the threat actors and campaigns it mirrors beside intrusion sets', () => {
    expect(isRelevantStixObject({ type: 'threat-actor', id: 'threat-actor--1' })).toBe(true);
    expect(isRelevantStixObject({ type: 'campaign', id: 'campaign--1' })).toBe(true);
  });

  it('accepts an attributed-to between two threats, in any of the directions STIX allows', () => {
    const attribution = (sourceRef: string, targetRef: string) =>
      ({ type: 'relationship', id: 'relationship--a', relationship_type: 'attributed-to', source_ref: sourceRef, target_ref: targetRef });
    expect(isRelevantStixObject(attribution('campaign--1', 'intrusion-set--1'))).toBe(true);
    expect(isRelevantStixObject(attribution('campaign--1', 'threat-actor--1'))).toBe(true);
    expect(isRelevantStixObject(attribution('intrusion-set--1', 'threat-actor--1'))).toBe(true);
  });

  it('rejects an attributed-to whose end is not a threat, an identity above all', () => {
    const attribution = (sourceRef: unknown, targetRef: unknown) =>
      ({ type: 'relationship', id: 'relationship--a', relationship_type: 'attributed-to', source_ref: sourceRef, target_ref: targetRef });
    expect(isRelevantStixObject(attribution('threat-actor--1', 'identity--1'))).toBe(false);
    expect(isRelevantStixObject(attribution('malware--1', 'intrusion-set--1'))).toBe(false);
    expect(isRelevantStixObject(attribution('campaign--1', undefined))).toBe(false);
  });

  it('rejects a relationship whose relationship_type it does not read', () => {
    expect(isRelevantStixObject({ type: 'relationship', id: 'relationship--2', relationship_type: 'indicates' })).toBe(false);
  });

  it('rejects the types it does not mirror', () => {
    for (const type of ['indicator', 'course-of-action', 'note']) {
      expect(isRelevantStixObject({ type, id: `${type}--1` })).toBe(false);
    }
  });

  it('rejects an object with no type field', () => {
    expect(isRelevantStixObject({ id: 'foo--1' })).toBe(false);
  });
});

describe('buildThreatEntriesFromObjects', () => {
  const group = { type: 'intrusion-set', id: 'intrusion-set--g', name: 'Group G' };
  const location = { type: 'location', id: 'location--fr', name: 'France', country: 'France' };

  it('builds the same entry as parseThreatBundle from a small targeted subgraph', () => {
    const rel = {
      type: 'relationship', id: 'relationship--r1', relationship_type: 'targets',
      source_ref: 'intrusion-set--g', target_ref: 'location--fr', created: '2024-01-01T00:00:00.000Z',
    };

    const [expected] = parseThreatBundle({ type: 'bundle', id: 'bundle--1', objects: [group, location, rel] });
    const [actual] = buildThreatEntriesFromObjects([group], [location, rel]);

    expect(actual).toEqual(expected);
  });

  it('resolves the producer name when the identity is part of the subgraph', () => {
    const producer = { type: 'identity', id: 'identity--producer', name: 'Acme CTI', identity_class: 'organization' };
    const rel = {
      type: 'relationship', id: 'relationship--r1', relationship_type: 'targets',
      source_ref: 'intrusion-set--g', target_ref: 'location--fr', created_by_ref: 'identity--producer',
    };

    const [entry] = buildThreatEntriesFromObjects([group], [location, producer, rel]);

    expect(entry?.locations).toEqual([expect.objectContaining({ producerStixId: 'identity--producer', producerName: 'Acme CTI' })]);
  });

  it('gives each intrusion set the entry it would get from a graph of its own', () => {
    const other = { type: 'intrusion-set', id: 'intrusion-set--h', name: 'Group H' };
    const belgium = { type: 'location', id: 'location--be', name: 'Belgium', country: 'Belgium' };
    const relG = {
      type: 'relationship', id: 'relationship--rg', relationship_type: 'targets',
      source_ref: 'intrusion-set--g', target_ref: 'location--fr',
    };
    const relH = {
      type: 'relationship', id: 'relationship--rh', relationship_type: 'targets',
      source_ref: 'intrusion-set--h', target_ref: 'location--be',
    };
    const related = [location, belgium, relG, relH];

    const shared = buildThreatEntriesFromObjects([group, other], related);

    expect(shared).toEqual([
      buildThreatEntriesFromObjects([group], related)[0],
      buildThreatEntriesFromObjects([other], related)[0],
    ]);
  });
});

describe('malware and reports around a threat', () => {
  const GROUP_ID = 'intrusion-set--00000000-0000-4000-8000-0000000000a1';
  const CAMPAIGN_ID = 'campaign--00000000-0000-4000-8000-0000000000b1';
  const LOADER_ID = 'malware--00000000-0000-4000-8000-0000000000c1';
  const WIPER_ID = 'malware--00000000-0000-4000-8000-0000000000c2';

  const group = { type: 'intrusion-set', id: GROUP_ID, name: 'Group Alpha' };
  const campaign = { type: 'campaign', id: CAMPAIGN_ID, name: 'Campaign Beta' };
  const loader = { type: 'malware', id: LOADER_ID, name: 'Loader One', malware_types: ['loader', 'backdoor'], description: 'A very long malware description.' };
  const wiper = { type: 'malware', id: WIPER_ID, name: 'Wiper Two' };
  const relation = (id: string, relationshipType: string, sourceRef: string, targetRef: string) =>
    ({ type: 'relationship', id: `relationship--${id}`, relationship_type: relationshipType, source_ref: sourceRef, target_ref: targetRef });

  const longDescription = `${'word '.repeat(400)}\n\ttail`;
  const reportCitingGroup = {
    type: 'report',
    id: 'report--00000000-0000-4000-8000-0000000000d1',
    name: 'Group Alpha lands again',
    description: '  First line.\n\n  Second\tline   with   gaps.  ',
    labels: ['source:feed', 'ransomware', 'pir:3'],
    published: '2025-03-04T10:00:00.000Z',
    object_refs: [GROUP_ID, 'indicator--00000000-0000-4000-8000-0000000000e1'],
  };
  const reportCitingCampaign = {
    type: 'report',
    id: 'report--00000000-0000-4000-8000-0000000000d2',
    name: 'Campaign Beta wave',
    description: longDescription,
    object_refs: [CAMPAIGN_ID],
  };
  const reportCitingMalware = {
    type: 'report',
    id: 'report--00000000-0000-4000-8000-0000000000d3',
    name: 'Loader One analysis',
    object_refs: [LOADER_ID],
  };

  const bundle = {
    type: 'bundle',
    id: 'bundle--1',
    objects: [
      group,
      campaign,
      loader,
      wiper,
      relation('att', 'attributed-to', CAMPAIGN_ID, GROUP_ID),
      relation('g-loader', 'uses', GROUP_ID, LOADER_ID),
      relation('g-loader-again', 'uses', GROUP_ID, LOADER_ID),
      relation('g-wiper', 'uses', GROUP_ID, WIPER_ID),
      relation('c-wiper', 'uses', CAMPAIGN_ID, WIPER_ID),
      relation('g-ghost', 'uses', GROUP_ID, 'malware--00000000-0000-4000-8000-0000000000ff'),
      reportCitingGroup,
      reportCitingCampaign,
      reportCitingMalware,
    ],
  };
  const entries = parseThreatBundle(bundle);
  const groupEntry = entries.find((entry) => entry.threat.stixId === GROUP_ID);
  const campaignEntry = entries.find((entry) => entry.threat.stixId === CAMPAIGN_ID);

  it('lists each malware a threat uses once, whatever the number of relationships', () => {
    expect(groupEntry?.malware).toEqual([
      { stixId: LOADER_ID, name: 'Loader One', types: ['loader', 'backdoor'] },
      { stixId: WIPER_ID, name: 'Wiper Two', types: [] },
    ]);
  });

  it('lists only the malware the threat itself uses, and only those present in the graph', () => {
    expect(campaignEntry?.malware).toEqual([{ stixId: WIPER_ID, name: 'Wiper Two', types: [] }]);
  });

  it('collects the reports citing a threat, with a collapsed summary and the labels as received', () => {
    expect(groupEntry?.reports).toEqual([{
      stixId: reportCitingGroup.id,
      title: 'Group Alpha lands again',
      summary: 'First line. Second line with gaps.',
      labels: ['source:feed', 'ransomware', 'pir:3'],
      published: new Date('2025-03-04T10:00:00.000Z'),
    }]);
  });

  it('cuts a long summary to 1200 characters and tolerates a report with no label or date', () => {
    const [report] = campaignEntry?.reports ?? [];
    expect(report?.summary).toHaveLength(1200);
    expect(report?.summary.startsWith('word word word')).toBe(true);
    expect(report?.labels).toEqual([]);
    expect(report?.published).toBeNull();
  });

  it('gives a report that cites no threat to nobody', () => {
    expect(entries.flatMap((entry) => entry.reports.map((report) => report.stixId))).not.toContain(reportCitingMalware.id);
  });

  it('indexes a report under every threat it cites, once', () => {
    const twice = { ...reportCitingGroup, object_refs: [GROUP_ID, GROUP_ID, CAMPAIGN_ID] };
    const graph = buildStixGraph([group, campaign, twice]);
    expect(graph.reportsByThreatId.get(GROUP_ID)).toEqual([twice]);
    expect(graph.reportsByThreatId.get(CAMPAIGN_ID)).toEqual([twice]);
  });

  it('builds the same malware and reports from a targeted subgraph', () => {
    const related = bundle.objects.filter((obj) => obj !== group && obj !== campaign);
    const [fromSubgraph] = buildThreatEntriesFromObjects([group], related);
    expect(fromSubgraph?.malware).toEqual(groupEntry?.malware);
    expect(fromSubgraph?.reports).toEqual(groupEntry?.reports);
  });

  describe('isRelevantStixObject', () => {
    it('keeps every malware', () => {
      expect(isRelevantStixObject(loader)).toBe(true);
      expect(isRelevantStixObject(wiper)).toBe(true);
    });

    it('keeps a report citing a threat', () => {
      expect(isRelevantStixObject(reportCitingGroup)).toBe(true);
      expect(isRelevantStixObject(reportCitingCampaign)).toBe(true);
    });

    it('drops a report citing no threat, or carrying no object_refs', () => {
      expect(isRelevantStixObject(reportCitingMalware)).toBe(false);
      expect(isRelevantStixObject({ type: 'report', id: 'report--x' })).toBe(false);
      expect(isRelevantStixObject({ type: 'report', id: 'report--y', object_refs: 'intrusion-set--z' })).toBe(false);
    });
  });

  describe('trimRelevantStixObject', () => {
    const fullReport = {
      type: 'report',
      spec_version: '2.1',
      id: 'report--00000000-0000-4000-8000-0000000000d9',
      name: 'Wide report',
      description: `${'x'.repeat(2000)}`,
      labels: ['ransomware'],
      published: '2025-03-04T10:00:00.000Z',
      created: '2025-03-04T09:00:00.000Z',
      modified: '2025-03-05T09:00:00.000Z',
      created_by_ref: 'identity--00000000-0000-4000-8000-0000000000f1',
      report_types: ['threat-report'],
      confidence: 80,
      external_references: [{ source_name: 'feed', url: 'https://example.test/r' }],
      extensions: { 'extension-definition--x': { id: 'internal-1' } },
      object_refs: [
        'indicator--00000000-0000-4000-8000-0000000000e1',
        GROUP_ID,
        'indicator--00000000-0000-4000-8000-0000000000e2',
        'indicator--00000000-0000-4000-8000-0000000000e3',
      ],
    };

    it('reduces a report to what the counter reads and to the threats it cites', () => {
      const trimmed = trimRelevantStixObject(fullReport);
      expect(Object.keys(trimmed).sort()).toEqual([
        'description', 'id', 'labels', 'name', 'object_refs', 'published', 'type',
      ]);
      expect(trimmed['object_refs']).toEqual([GROUP_ID]);
      expect(trimmed['description']).toBe('x'.repeat(1200));
    });

    it('cuts the description the way the parser reads it, so the parser result does not change', () => {
      const parse = (report: Record<string, unknown>) =>
        buildThreatEntriesFromObjects([group], [report])[0]?.reports;
      expect(parse(trimRelevantStixObject(fullReport))).toEqual(parse(fullReport));
      expect(parse(trimRelevantStixObject(reportCitingGroup))).toEqual(parse(reportCitingGroup));
    });

    it('invents no key a report does not carry', () => {
      const trimmed = trimRelevantStixObject(reportCitingMalware);
      expect(trimmed).toEqual({ id: reportCitingMalware.id, type: 'report', name: 'Loader One analysis', object_refs: [] });
    });

    it('reduces a malware to its name and types, without its description', () => {
      const trimmed = trimRelevantStixObject({
        ...loader,
        spec_version: '2.1',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-02T00:00:00.000Z',
        created_by_ref: 'identity--00000000-0000-4000-8000-0000000000f1',
        is_family: true,
        labels: ['x'],
      });
      expect(trimmed).toEqual({
        id: LOADER_ID,
        type: 'malware',
        name: 'Loader One',
        malware_types: ['loader', 'backdoor'],
      });
    });

    it('returns any other object as the same reference', () => {
      expect(trimRelevantStixObject(group)).toBe(group);
      const rel = relation('x', 'uses', GROUP_ID, LOADER_ID);
      expect(trimRelevantStixObject(rel)).toBe(rel);
    });

    it('is stable: trimming a trimmed object changes nothing', () => {
      const once = trimRelevantStixObject(fullReport);
      expect(trimRelevantStixObject(once)).toEqual(once);
    });
  });
});
