import { z } from 'zod';
import type { ParsedThreatInput } from '../threat-analyses/service';
import { ACTOR_CLASS_VALUES, DEFAULT_ACTOR_CLASS } from '../threat-analyses/actor-classes';
import { mitreTechniquesData } from '../mitre-attack/data/mitre-techniques';

/** The file this connector release reads, under the dataset URL: one file per format major. */
export const DEFAULT_THREATS_DATASET_FILE = 'default-threats-v1.json';

const MITRE_THREAT_ID = /^[GC]\d{4}$/;

/** A threat's STIX id is its MITRE id, so a hand upload of MITRE's own bundle never resolves to the connector's rows. */
export const defaultThreatStixId = (mitreId: string): string => `threat--${mitreId}`;

/** The file carries no confidence, so the connector's own applies to every threat and claim it loads. */
export const DEFAULT_THREATS_CONFIDENCE = 80;

export interface DatasetTechniqueRef {
  stixId: string,
  externalId: string,
  name: string,
}

const catalogueByStixId = new Map<string, DatasetTechniqueRef>(
  mitreTechniquesData.map((technique) => [technique.stixId, { stixId: technique.stixId, externalId: technique.externalId, name: technique.name }]),
);

export const lookupCatalogueTechnique = (stixId: string): DatasetTechniqueRef | undefined =>
  catalogueByStixId.get(stixId);

const ATTACK_PATTERN_ID = /^attack-pattern--/;

// Every object is read leniently, field by field: the format may grow within its major, and a field
// this release does not know is ignored rather than failing the sync.
const optionalString = z.string().nullish().catch(null);

const externalReferencesSchema = z.array(z.object({
  source_name: z.string().catch(''),
  external_id: optionalString,
}).catch({ source_name: '', external_id: null })).catch([]);

const baseObjectSchema = z.object({
  type: z.string(),
  id: z.string(),
  revoked: z.boolean().nullish().catch(null),
  x_mitre_deprecated: z.boolean().nullish().catch(null),
});

const threatObjectSchema = baseObjectSchema.extend({
  type: z.enum(['intrusion-set', 'campaign']),
  name: z.string(),
  description: optionalString,
  aliases: z.array(z.string()).nullish().catch(null),
  created: optionalString,
  first_seen: optionalString,
  last_seen: optionalString,
  external_references: externalReferencesSchema.nullish(),
});

const relationshipSchema = baseObjectSchema.extend({
  type: z.literal('relationship'),
  relationship_type: z.string(),
  source_ref: z.string(),
  target_ref: z.string(),
  created: optionalString,
  modified: optionalString,
  start_time: optionalString,
  stop_time: optionalString,
  created_by_ref: optionalString,
});

const identitySchema = baseObjectSchema.extend({ type: z.literal('identity'), name: z.string() });

const outcomeAssessmentSchema = baseObjectSchema.extend({
  type: z.literal('x-opencrq-outcome-assessment'),
  object_ref: z.string(),
  method: z.string(),
  modified: z.iso.datetime(),
  outcome_probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

const actorClassAssessmentSchema = baseObjectSchema.extend({
  type: z.literal('x-opencrq-actor-class-assessment'),
  object_ref: z.string(),
  // The methods this release knows: one added later may rest on weaker evidence than these two.
  method: z.enum(['judged', 'attributed-group']),
  // A class added to the format after this release reads as the default class.
  actor_class: z.union([z.enum(ACTOR_CLASS_VALUES), z.string().transform(() => DEFAULT_ACTOR_CLASS)]),
});

const datasetReleaseSchema = baseObjectSchema.extend({ type: z.literal('x-opencrq-dataset-release'), attack_release: z.string() });

const bundleSchema = z.object({ type: z.literal('bundle'), objects: z.array(z.unknown()) });

export interface DefaultThreatsDataset {
  /** The ATT&CK release the file's `x-opencrq-dataset-release` object states, null when it holds none. */
  attackRelease: string | null,
  threats: Array<ParsedThreatInput>,
  /** Technique claims left out because the catalogue does not know the technique. */
  ignoredTechniqueClaims: number,
}

const mitreIdOf = (references: z.infer<typeof externalReferencesSchema> | null | undefined): string | null =>
  references?.find((reference) => reference.source_name === 'mitre-attack')?.external_id ?? null;

const toDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isLive = (object: z.infer<typeof baseObjectSchema>): boolean => object.revoked !== true && object.x_mitre_deprecated !== true;

/**
 * Reads the dataset's live groups and campaigns into ingestible threats. Throws on a file that is not
 * a STIX bundle, so a sync fails and keeps the threats; anything else it does not know it ignores.
 *
 * The file holds no technique: a claim cites one by MITRE's STIX id, which the catalogue resolves
 * and names. A claim on a technique the catalogue does not know is left out, to load with the first
 * sync after an upgrade that brings it. Threats and claims take the connector's confidence.
 *
 * A live, judged `x-opencrq-outcome-assessment` gives its threat the outcome probabilities it states, keyed
 * by catalogue attack-outcome id, unknown ids included: ingestion keeps only the outcomes it knows.
 * One with a probability outside [0, 1] is ignored whole, since the file is then not what it claims.
 * A live `x-opencrq-actor-class-assessment` gives its threat the actor class it states when its method
 * is `judged` or `attributed-group` (the class of the groups a campaign is attributed to), on a group
 * or a campaign alike.
 */
export const parseDefaultThreatsDataset = (
  json: unknown,
  lookupTechnique: (stixId: string) => DatasetTechniqueRef | undefined = lookupCatalogueTechnique,
): DefaultThreatsDataset => {
  const { objects } = bundleSchema.parse(json);

  let attackRelease: string | null = null;
  const producers = new Map<string, string>();
  const threats = new Map<string, z.infer<typeof threatObjectSchema> & { mitreId: string }>();
  const relationships: Array<z.infer<typeof relationshipSchema>> = [];
  const assessments: Array<z.infer<typeof outcomeAssessmentSchema>> = [];
  const classAssessments: Array<z.infer<typeof actorClassAssessmentSchema>> = [];

  for (const object of objects) {
    const base = baseObjectSchema.safeParse(object);
    if (!base.success) {
      continue;
    }
    switch (base.data.type) {
      case 'x-opencrq-dataset-release': {
        const release = datasetReleaseSchema.safeParse(object);
        if (release.success) {
          attackRelease = release.data.attack_release;
        }
        break;
      }
      case 'identity': {
        const identity = identitySchema.safeParse(object);
        if (identity.success) {
          producers.set(identity.data.id, identity.data.name);
        }
        break;
      }
      case 'intrusion-set':
      case 'campaign': {
        const threat = threatObjectSchema.safeParse(object);
        const mitreId = threat.success ? mitreIdOf(threat.data.external_references) : null;
        if (threat.success && isLive(threat.data) && mitreId !== null && MITRE_THREAT_ID.test(mitreId)) {
          threats.set(threat.data.id, { ...threat.data, mitreId });
        }
        break;
      }
      case 'relationship': {
        const relationship = relationshipSchema.safeParse(object);
        if (relationship.success && isLive(relationship.data)) {
          relationships.push(relationship.data);
        }
        break;
      }
      case 'x-opencrq-outcome-assessment': {
        // Only the judged method gives probabilities that may stand in for the counter's.
        const assessment = outcomeAssessmentSchema.safeParse(object);
        if (assessment.success && isLive(assessment.data) && assessment.data.method === 'judged') {
          assessments.push(assessment.data);
        }
        break;
      }
      case 'x-opencrq-actor-class-assessment': {
        const assessment = actorClassAssessmentSchema.safeParse(object);
        if (assessment.success && isLive(assessment.data)) {
          classAssessments.push(assessment.data);
        }
        break;
      }
      default:
        break;
    }
  }

  const byStixId = new Map<string, ParsedThreatInput>();
  // Two objects claiming one MITRE id would write one row twice: the first one stands.
  const seenMitreIds = new Set<string>();
  for (const threat of threats.values()) {
    if (seenMitreIds.has(threat.mitreId)) {
      continue;
    }
    seenMitreIds.add(threat.mitreId);
    byStixId.set(threat.id, {
      threat: {
        stixId: defaultThreatStixId(threat.mitreId),
        entityType: threat.type,
        name: threat.name,
        description: threat.description ?? null,
        mitreGroupId: threat.mitreId,
        confidence: DEFAULT_THREATS_CONFIDENCE,
        stixCreated: toDate(threat.created),
        firstSeen: toDate(threat.first_seen),
        lastSeen: toDate(threat.last_seen),
        primaryMotivation: null,
        resourceLevel: null,
        sophistication: null,
        objective: null,
        labels: [],
      },
      aliases: (threat.aliases ?? []).filter((alias) => alias !== threat.name),
      secondaryMotivations: [],
      goals: [],
      threatActorTypes: [],
      roles: [],
      attributions: [],
      locations: [],
      sectors: [],
      cves: [],
      techniques: [],
    });
  }

  for (const assessment of assessments) {
    const threat = byStixId.get(assessment.object_ref);
    // Two assessments of one threat would each claim its probabilities: the first one stands.
    if (threat !== undefined && threat.judgedOutcomes === undefined) {
      threat.judgedOutcomes = {
        judgedAt: new Date(assessment.modified),
        probabilities: new Map(Object.entries(assessment.outcome_probabilities)),
      };
    }
  }

  for (const assessment of classAssessments) {
    const threat = byStixId.get(assessment.object_ref);
    if (threat !== undefined && threat.statedActorClass === undefined) {
      threat.statedActorClass = assessment.actor_class;
    }
  }

  let ignoredTechniqueClaims = 0;
  for (const relationship of relationships) {
    const source = byStixId.get(relationship.source_ref);
    if (source === undefined) {
      continue;
    }
    const claim = {
      stixRelationId: relationship.id,
      producerStixId: relationship.created_by_ref ?? null,
      producerName: relationship.created_by_ref ? producers.get(relationship.created_by_ref) ?? null : null,
      isInferred: false,
      relCreated: toDate(relationship.created),
      relStartTime: toDate(relationship.start_time),
      relStopTime: toDate(relationship.stop_time),
      relModified: toDate(relationship.modified),
      relConfidence: DEFAULT_THREATS_CONFIDENCE,
    };
    if (relationship.relationship_type === 'uses') {
      if (!ATTACK_PATTERN_ID.test(relationship.target_ref)) {
        continue;
      }
      const technique = lookupTechnique(relationship.target_ref);
      if (technique === undefined) {
        ignoredTechniqueClaims += 1;
        continue;
      }
      if (source.techniques.some((claimed) => claimed.mitreExternalId === technique.externalId)) {
        continue;
      }
      source.techniques.push({ stixId: technique.stixId, name: technique.name, mitreExternalId: technique.externalId, ...claim });
    } else if (relationship.relationship_type === 'attributed-to') {
      const target = byStixId.get(relationship.target_ref);
      if (target !== undefined && target !== source) {
        source.attributions.push({ targetStixId: target.threat.stixId, ...claim });
      }
    }
  }

  return { attackRelease, threats: [...byStixId.values()], ignoredTechniqueClaims };
};
