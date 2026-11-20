import type { DrizzleDB, ParsedThreatInput } from '@app/module';
import { AttackOutcome_DataBreachResale, AttackOutcome_Espionage, AttackOutcome_FinancialFraudFundsTheft, AttackOutcome_Ransomware, AttackOutcome_ServiceDisruption, THREAT_RELEVANCE_DEFAULTS, threatAnalyses, threatAnalysisOutcomeProbabilities } from '@app/module';
import { and, eq } from 'drizzle-orm';

export const THREAT_ID = 'intrusion-set--11111111-1111-1111-1111-111111111111';
export const KNOWN_CVE_ID = 'CVE-2024-9001';
export const UNKNOWN_CVE_ID = 'CVE-2024-9002';
export const KNOWN_MITRE_TECHNIQUE_ID = 'T1053'; // Scheduled Task/Job, seeded MITRE reference data.
export const UNKNOWN_MITRE_TECHNIQUE_ID = 'T9999'; // Not part of the seeded MITRE technique catalog.

// Shared provenance for fixture claims that don't specifically exercise producer resolution or
// inference (covered separately in the parser's own unit tests).
export const DEFAULT_PROVENANCE = { producerStixId: 'identity--test-producer', producerName: 'Test Producer', isInferred: false };

// Every shared fixture claim states a confidence at or above the shipped gate, so a test that is
// not about the gate never has one silently applied to it. The gate's own suite states its
// confidences by hand, including the below-gate and unstated ones.
export const ABOVE_GATE = THREAT_RELEVANCE_DEFAULTS.confidenceGate;

// What the outcome counter reads a threat's outcomes from: a description naming the outcome puts
// its stored percentage above the 0.5 a threat needs to be selected, which a test asserts on the
// stored value rather than assuming. Service Disruption's alone does not: the counter leans on
// structured fields over free text, so it also needs the flood techniques of `buildDisruptionEntry`
// or the malware of `MALWARE_BY_OUTCOME`.
export const RANSOMWARE_DESCRIPTION = 'A ransomware group that encrypts files on victim networks and demands a ransom payment in exchange for the decryption key, running ransomware as a service for financial gain.';
export const DATA_BREACH_DESCRIPTION = 'A financially motivated group, active since June, that has compromised thousands of retail and hospitality victims, using a stealer for browser credential theft, and sells the stolen credentials and customer data. It has been advertising access as a service.';
export const DISRUPTION_DESCRIPTION = 'A hacktivist collective that attacks power, water and government services, flooding websites with DDoS traffic to disrupt online services and cause outages, a destructive incident each time.';
export const ESPIONAGE_DESCRIPTION = 'The group conducts cyber espionage campaigns against government and defense organizations to steal sensitive intelligence on behalf of a nation state.';
export const FRAUD_DESCRIPTION = 'The group conducts financial fraud, stealing funds from bank accounts through business email compromise and fraudulent wire transfers.';

// A record naming no outcome still reads near 0.5 on one of them, from a prior on its motivation,
// sector and name. A test that blanks the description of `buildDisruptionEntry`, or of the base entry
// once its aliases are dropped, uses this wording to keep every outcome under 0.5.
export const UNREMARKABLE_DESCRIPTION = 'An intrusion set that is only used in tests.';

/** The malware a threat needs beside `DESCRIPTION_BY_OUTCOME` for the counter to score the outcome over 0.5, by catalogue id. */
export const MALWARE_BY_OUTCOME: Readonly<Record<string, ParsedThreatInput['malware']>> = {
  [AttackOutcome_ServiceDisruption]: [{ stixId: 'malware--disruption-tool', name: 'Flood Tool', types: ['disruption-tool'] }],
};

/** The description above that the counter scores over 0.5 on a catalogue outcome (Service Disruption's with `MALWARE_BY_OUTCOME`), by the outcome's catalogue id. */
export const DESCRIPTION_BY_OUTCOME: Readonly<Record<string, string>> = {
  [AttackOutcome_Ransomware]: RANSOMWARE_DESCRIPTION,
  [AttackOutcome_DataBreachResale]: DATA_BREACH_DESCRIPTION,
  [AttackOutcome_FinancialFraudFundsTheft]: FRAUD_DESCRIPTION,
  [AttackOutcome_Espionage]: ESPIONAGE_DESCRIPTION,
  [AttackOutcome_ServiceDisruption]: DISRUPTION_DESCRIPTION,
};

// The weight a stored percentage gives a threat and the targeting factors, restated as the
// products they are so a change to either shows in the expected value instead of hiding in it.
export const outcomeWeightOf = (probability: number): number => ((probability - 0.5) / 0.5) ** 2;
export const MAX_TAU = 2.5 * 4;

// The limit is high enough for a fixture's whole catalog to fit on page 1, so `items` is never a slice.
export const DEFAULT_LIST_PARAMS = { page: 1, limit: 500, sortDesc: true };

/**
 * Builds a `ParsedThreatInput` fixture directly rather than through the parser, which carries
 * its own unit tests: this one is about persistence and enrichment.
 *
 * `variant` tweaks the child set slightly so re-ingestion tests can assert the old
 * children were fully replaced (not just appended to).
 */
export const buildParsedEntry = (variant: 'initial' | 'updated' = 'initial'): ParsedThreatInput => ({
  threat: {
    stixId: THREAT_ID,
    entityType: 'intrusion-set',
    name: variant === 'initial' ? 'Test Intrusion Set' : 'Test Intrusion Set (renamed)',
    description: 'A fixture intrusion-set for integration tests.',
    mitreGroupId: 'G9999',
    confidence: 80,
    stixCreated: new Date('2023-12-01T00:00:00.000Z'),
    firstSeen: new Date('2024-01-01T00:00:00.000Z'),
    lastSeen: new Date('2024-06-01T00:00:00.000Z'),
    primaryMotivation: 'organizational-gain',
    resourceLevel: 'government',
    sophistication: null,
    objective: null,
    labels: [],
  },
  // The "updated" variant renames one alias and adds a case variant of another: re-ingestion must
  // replace the whole set, and the case variant must be deduped away by the service.
  aliases: variant === 'initial'
    ? ['Test Group', 'TG-9999']
    : ['Test Group', 'test group', 'TG-0001'],
  secondaryMotivations: [],
  goals: [],
  threatActorTypes: [],
  roles: [],
  attributions: [],
  locations: [
    {
      stixId: 'location--france',
      stixRelationId: 'relationship--france',
      name: 'France',
      country: 'France',
      ...DEFAULT_PROVENANCE,
      relCreated: null,
      relStartTime: new Date('2024-01-01T00:00:00.000Z'),
      relStopTime: null,
      relModified: null,
      relConfidence: 90,
    },
    // The "updated" variant drops the region-level location, proves replaceChildren wipes it.
    ...(variant === 'initial'
      ? [{
        stixId: 'location--western-europe',
        stixRelationId: 'relationship--western-europe',
        name: 'Western Europe',
        country: null,
        ...DEFAULT_PROVENANCE,
        relCreated: null,
        relStartTime: null,
        relStopTime: null,
        relModified: null,
        relConfidence: ABOVE_GATE,
      }]
      : []),
  ],
  sectors: [
    {
      stixId: 'identity--defense',
      stixRelationId: 'relationship--defense',
      name: 'Defense',
      ...DEFAULT_PROVENANCE,
      relCreated: null,
      relStartTime: null,
      relStopTime: null,
      relModified: null,
      relConfidence: ABOVE_GATE,
    },
  ],
  cves: [
    { stixId: 'vulnerability--known', stixRelationId: 'relationship--known-cve', cveId: KNOWN_CVE_ID, ...DEFAULT_PROVENANCE, relCreated: null, relStartTime: null, relStopTime: null, relModified: null, relConfidence: ABOVE_GATE },
    { stixId: 'vulnerability--unknown', stixRelationId: 'relationship--unknown-cve', cveId: UNKNOWN_CVE_ID, ...DEFAULT_PROVENANCE, relCreated: null, relStartTime: null, relStopTime: null, relModified: null, relConfidence: ABOVE_GATE },
  ],
  techniques: [
    {
      stixId: 'attack-pattern--known',
      stixRelationId: 'relationship--known-technique',
      name: 'Scheduled Task/Job',
      mitreExternalId: KNOWN_MITRE_TECHNIQUE_ID,
      ...DEFAULT_PROVENANCE,
      relCreated: null,
      relStartTime: null,
      relStopTime: null,
      relModified: null,
      relConfidence: ABOVE_GATE,
    },
    {
      stixId: 'attack-pattern--unknown',
      stixRelationId: 'relationship--unknown-technique',
      name: 'Fake Technique',
      mitreExternalId: UNKNOWN_MITRE_TECHNIQUE_ID,
      ...DEFAULT_PROVENANCE,
      relCreated: null,
      relStartTime: null,
      relStopTime: null,
      relModified: null,
      relConfidence: ABOVE_GATE,
    },
  ],
});

// Techniques overlapping the Service Disruption outcome, and only that one: T1498 (signature),
// T1499 (signature, observed as the sub-technique T1499.001) and T1531 (related). No other
// catalog outcome curates any of them, so the fixture scores exactly once.
export const buildDisruptionEntry = (): ParsedThreatInput => {
  const base = buildParsedEntry('initial');
  const relMeta = { ...DEFAULT_PROVENANCE, relCreated: null, relStartTime: null, relStopTime: null, relModified: null };
  return {
    ...base,
    // A DIFFERENT actor from the base fixture, down to its MITRE group id and its aliases: those
    // are what the attacker-mixture clustering folds duplicates on, so sharing one would make the
    // two fixtures a single group in a risk figure.
    threat: {
      ...base.threat,
      stixId: 'intrusion-set--22222222-2222-2222-2222-222222222222',
      name: 'Disruption Crew',
      mitreGroupId: 'G9998',
      description: DISRUPTION_DESCRIPTION,
    },
    aliases: ['Disruption Crew', 'DC-9998'],
    locations: [],
    sectors: [],
    cves: [],
    techniques: [
      { ...relMeta, stixId: 'attack-pattern--net-dos', stixRelationId: 'relationship--net-dos', name: 'Network Denial of Service', mitreExternalId: 'T1498', relConfidence: 80 },
      { ...relMeta, stixId: 'attack-pattern--os-flood', stixRelationId: 'relationship--os-flood', name: 'Endpoint Denial of Service: OS Exhaustion Flood', mitreExternalId: 'T1499.001', relConfidence: 80 },
      { ...relMeta, stixId: 'attack-pattern--account-removal', stixRelationId: 'relationship--account-removal', name: 'Account Access Removal', mitreExternalId: 'T1531', relConfidence: ABOVE_GATE },
    ],
  };
};

/** The base fixture, now describing a ransomware crew: selected for the Ransomware outcome. */
export const buildRansomwareEntry = (overrides: { stixId?: string, name?: string, mitreGroupId?: string } = {}): ParsedThreatInput => {
  const base = buildParsedEntry('initial');
  return {
    ...base,
    threat: {
      ...base.threat,
      description: RANSOMWARE_DESCRIPTION,
      ...(overrides.stixId ? { stixId: overrides.stixId } : {}),
      ...(overrides.name ? { name: overrides.name } : {}),
      ...(overrides.mitreGroupId ? { mitreGroupId: overrides.mitreGroupId } : {}),
    },
    aliases: overrides.name ? [overrides.name] : base.aliases,
  };
};

/** The percentage the counter stored for a threat on an outcome, read from the table. */
export const readStoredProbability = async (db: DrizzleDB, stixId: string, attackOutcomeId: string): Promise<number> => {
  const [row] = await db.select({ probability: threatAnalysisOutcomeProbabilities.probability })
    .from(threatAnalysisOutcomeProbabilities)
    .innerJoin(threatAnalyses, eq(threatAnalyses.id, threatAnalysisOutcomeProbabilities.analysisId))
    .where(and(eq(threatAnalyses.stixId, stixId), eq(threatAnalysisOutcomeProbabilities.attackOutcomeId, attackOutcomeId)));
  if (!row) {
    throw new Error(`No stored percentage for ${stixId} on ${attackOutcomeId}`);
  }
  return row.probability;
};
