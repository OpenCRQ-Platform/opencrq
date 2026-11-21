import { z } from 'zod';
import type { ThreatEntityType } from './entity-types';
import { NonRetryableError } from '../jobs/types';
import { isThreatEntityType, THREAT_ENTITY_TYPES } from './entity-types';

/** Provenance every claim row carries, identical across the four claim kinds. */
export interface ParsedClaimProvenance {
  stixRelationId: string,
  producerStixId: string | null,
  producerName: string | null,
  isInferred: boolean,
  relCreated: Date | null,
  relStartTime: Date | null,
  relStopTime: Date | null,
  relModified: Date | null,
  relConfidence: number | null,
}

export interface ParsedLocation extends ParsedClaimProvenance {
  stixId: string,
  name: string,
  country: string | null,
}

export interface ParsedSector extends ParsedClaimProvenance {
  stixId: string,
  name: string,
}

export interface ParsedCve extends ParsedClaimProvenance {
  stixId: string,
  cveId: string,
}

export interface ParsedTechnique extends ParsedClaimProvenance {
  stixId: string,
  name: string,
  mitreExternalId: string,
}

export interface ParsedAttribution extends ParsedClaimProvenance {
  targetStixId: string,
}

export interface ParsedMalware {
  stixId: string,
  name: string,
  types: Array<string>,
}

export interface ParsedReport {
  stixId: string,
  title: string,
  summary: string,
  labels: Array<string>,
  published: Date | null,
}

export interface ParsedThreat {
  threat: {
    stixId: string,
    entityType: ThreatEntityType,
    name: string,
    description: string | null,
    mitreGroupId: string | null,
    confidence: number | null,
    stixCreated: Date | null,
    firstSeen: Date | null,
    lastSeen: Date | null,
    primaryMotivation: string | null,
    resourceLevel: string | null,
    sophistication: string | null,
    objective: string | null,
    labels: Array<string>,
    markingRefs: Array<string>,
  },
  aliases: Array<string>,
  secondaryMotivations: Array<string>,
  goals: Array<string>,
  threatActorTypes: Array<string>,
  roles: Array<string>,
  attributions: Array<ParsedAttribution>,
  locations: Array<ParsedLocation>,
  sectors: Array<ParsedSector>,
  cves: Array<ParsedCve>,
  techniques: Array<ParsedTechnique>,
  malware: Array<ParsedMalware>,
  reports: Array<ParsedReport>,
}

const bundleSchema = z.object({
  type: z.literal('bundle'),
  objects: z.array(z.record(z.string(), z.unknown())),
});

type StixObject = Record<string, unknown>;

const MITRE_ATTACK_SOURCE = 'mitre-attack';

const toDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getString = (obj: StixObject, key: string): string | null => {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
};

const getNumber = (obj: StixObject, key: string): number | null => {
  const value = obj[key];
  return typeof value === 'number' ? value : null;
};

const getStixId = (obj: StixObject): string => getString(obj, 'id') ?? '';

// A STIX identifier is `<type>--<uuid>`.
const stixTypeOfId = (stixId: string): string => stixId.split('--')[0] ?? '';

const getStringArray = (obj: StixObject, key: string): Array<string> => {
  const values = obj[key];
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const isStixObject = (value: unknown): value is StixObject => value !== null && typeof value === 'object';

// Where a full STIX 2.1 export from OpenCTI puts `x_mitre_id`. A simple bundle export puts it at
// the top level instead, a raw ATT&CK export nowhere.
const MITRE_STIX_EXTENSION_ID = 'extension-definition--322b8f77-262a-4cb8-a915-1e441e00329b';

const getNonEmptyString = (obj: StixObject, key: string): string | null => {
  const value = getString(obj, key);
  return value !== null && value.trim().length > 0 ? value : null;
};

const getOwnMitreId = (obj: StixObject): string | null => {
  const extensions = obj['extensions'];
  const extension = isStixObject(extensions) ? extensions[MITRE_STIX_EXTENSION_ID] : null;
  const extensionId = isStixObject(extension) ? getNonEmptyString(extension, 'id') : null;
  return extensionId ?? getNonEmptyString(obj, 'x_mitre_id');
};

// ATT&CK publishes `T1566.001` under `.../techniques/T1566/001`, `G0007` under `.../groups/G0007`.
const referenceUrlStates = (ref: StixObject, externalId: string): boolean => {
  const url = getString(ref, 'url');
  if (url === null) {
    return false;
  }
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith(`/${externalId}`) || trimmed.endsWith(`/${externalId.replaceAll('.', '/')}`);
};

/**
 * A renumbered technique keeps its retired id among its `mitre-attack` references, often ahead of
 * the current one, because OpenCTI merged the retired object into it: the object's own id decides,
 * then the reference its url confirms.
 */
const resolveMitreId = (obj: StixObject): string | null => {
  const ownId = getOwnMitreId(obj);
  if (ownId !== null) {
    return ownId;
  }
  const refs = obj['external_references'];
  if (!Array.isArray(refs)) {
    return null;
  }
  const candidates = refs
    .filter((ref): ref is StixObject => isStixObject(ref) && ref['source_name'] === MITRE_ATTACK_SOURCE)
    .map((ref) => ({ ref, externalId: getNonEmptyString(ref, 'external_id') }))
    .filter((candidate): candidate is { ref: StixObject, externalId: string } => candidate.externalId !== null);
  const confirmed = candidates.find((candidate) => referenceUrlStates(candidate.ref, candidate.externalId));
  return (confirmed ?? candidates[0])?.externalId ?? null;
};

// OpenCTI exports may populate either `aliases` or `x_opencti_aliases`.
const ALIAS_KEYS = ['aliases', 'x_opencti_aliases'] as const;

// Aliases and declared intent values both sit under a unique index on `lower(value)`, and a btree
// index tuple cannot exceed roughly a third of a page. An oversized string raises an error that
// escapes `onConflictDoNothing` and aborts the rest of the bundle, so it is dropped here instead.
const MAX_INDEXED_VALUE_LENGTH = 512;

// Dedup happens in `dedupeAliases`, not here.
const extractAliases = (obj: StixObject): Array<string> => {
  const aliases: Array<string> = [];
  for (const key of ALIAS_KEYS) {
    const values = obj[key];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }
      const alias = value.trim();
      if (alias.length > 0 && alias.length <= MAX_INDEXED_VALUE_LENGTH) {
        aliases.push(alias);
      }
    }
  }
  return aliases;
};

// Shared reader for the STIX list-of-string properties stored under a `lower(value)` unique index.
// A non-array property, a non-string element, an empty string and an over-long one are all dropped
// silently.
const extractStringList = (obj: StixObject, key: string): Array<string> => {
  const values = obj[key];
  if (!Array.isArray(values)) {
    return [];
  }
  const result: Array<string> = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_INDEXED_VALUE_LENGTH) {
      result.push(trimmed);
    }
  }
  return result;
};

// OpenCTI stamps its own id and `is_inferred` inside this extension; simple bundle exports carry
// `x_opencti_id` at the top level instead.
const OPENCTI_STIX_EXTENSION_ID = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';

const getOpenCtiExtension = (rel: StixObject): StixObject | null => {
  const extensions = rel['extensions'];
  if (!isStixObject(extensions)) {
    return null;
  }
  const extension = extensions[OPENCTI_STIX_EXTENSION_ID];
  return isStixObject(extension) ? extension : null;
};

/**
 * Reads the provenance of one claim from the relationship that states it. Everything is taken as
 * received: no normalization, no stand-in value for an unresolvable producer.
 */
const extractRelationMeta = (rel: StixObject, objectsById: Map<string, StixObject>): ParsedClaimProvenance => {
  const extension = getOpenCtiExtension(rel);
  const producerStixId = getString(rel, 'created_by_ref');
  const producer = producerStixId === null ? undefined : objectsById.get(producerStixId);
  return {
    stixRelationId: getStixId(rel),
    producerStixId,
    producerName: producer ? getString(producer, 'name') : null,
    isInferred: extension?.['is_inferred'] === true,
    relCreated: toDate(rel['created']),
    relStartTime: toDate(rel['start_time']),
    relStopTime: toDate(rel['stop_time']),
    relModified: toDate(rel['modified']),
    relConfidence: getNumber(rel, 'confidence'),
  };
};

// ── Relevance filter ─────────────────────────────────────────────────────────────────

const RELEVANT_STIX_TYPES = new Set<string>([...THREAT_ENTITY_TYPES, 'location', 'identity', 'vulnerability', 'attack-pattern', 'malware']);
const RELEVANT_RELATIONSHIP_TYPES = new Set(['targets', 'uses']);

// `class` is a sector, `organization` is a producer named by a relationship's `created_by_ref`.
const RELEVANT_IDENTITY_CLASSES = new Set(['class', 'organization']);

const isThreatStixId = (stixId: string | null): boolean => stixId !== null && isThreatEntityType(stixTypeOfId(stixId));

// The counter reads the first characters of a report summary, and the mirror stores no more.
const MAX_REPORT_SUMMARY_LENGTH = 1200;

const summarize = (description: string): string => description.replace(/\s+/g, ' ').trim().slice(0, MAX_REPORT_SUMMARY_LENGTH);

/** The threats a report cites, each once. */
export const threatRefsOf = (report: StixObject): Array<string> => {
  const refs = report['object_refs'];
  if (!Array.isArray(refs)) {
    return [];
  }
  return [...new Set(refs.filter((ref): ref is string => typeof ref === 'string' && isThreatStixId(ref)))];
};

const pickPresent = (obj: StixObject, keys: ReadonlyArray<string>): StixObject =>
  Object.fromEntries(keys.filter((key) => key in obj).map((key) => [key, obj[key]]));

/**
 * Whether the Live Stream mirror keeps a STIX object. It gates renames and merges too, which the
 * connector handles only for an object it kept.
 */
export const isRelevantStixObject = (obj: StixObject): boolean => {
  const type = obj['type'];
  if (type === 'relationship') {
    const relationshipType = getString(obj, 'relationship_type');
    if (relationshipType === 'attributed-to') {
      return isThreatStixId(getString(obj, 'source_ref')) && isThreatStixId(getString(obj, 'target_ref'));
    }
    return relationshipType !== null && RELEVANT_RELATIONSHIP_TYPES.has(relationshipType);
  }
  if (type === 'identity') {
    return typeof obj['identity_class'] === 'string' && RELEVANT_IDENTITY_CLASSES.has(obj['identity_class']);
  }
  if (type === 'report') {
    return threatRefsOf(obj).length > 0;
  }
  return typeof type === 'string' && RELEVANT_STIX_TYPES.has(type);
};

const REPORT_KEPT_KEYS = ['id', 'type', 'name', 'labels', 'published'];
const MALWARE_KEPT_KEYS = ['id', 'type', 'name', 'malware_types'];

/**
 * What the mirror stores of a relevant object: a report and a malware keep only what the outcome
 * counter reads, so the parsed result is the same as from the original. Any other object is
 * returned as received.
 */
export const trimRelevantStixObject = (obj: StixObject): StixObject => {
  if (obj['type'] === 'report') {
    const trimmed = pickPresent(obj, REPORT_KEPT_KEYS);
    const description = getString(obj, 'description');
    if (description !== null) {
      trimmed['description'] = summarize(description);
    }
    trimmed['object_refs'] = threatRefsOf(obj);
    return trimmed;
  }
  if (obj['type'] === 'malware') {
    return pickPresent(obj, MALWARE_KEPT_KEYS);
  }
  return obj;
};

// ── Graph resolution ─────────────────────────────────────────────────────────────────

// The two lookups `buildThreatEntry` needs: an object by id, and a source's outgoing
// relationships of one type. Built once in-memory over a full bundle (`parseThreatBundle`),
// or from a small DB-fetched subgraph scoped to a single intrusion-set (the Live Stream connector).
export interface StixGraph {
  objectsById: Map<string, StixObject>,
  relationshipsBySourceAndType: Map<string, Array<StixObject>>,
  reportsByThreatId: Map<string, Array<StixObject>>,
}

// Index by `${source_ref}|${relationship_type}` for O(1) lookup per source.
export const buildStixGraph = (objects: Array<StixObject>): StixGraph => {
  const objectsById = new Map<string, StixObject>();
  for (const obj of objects) {
    const id = getString(obj, 'id');
    if (id) {
      objectsById.set(id, obj);
    }
  }

  const relationshipsBySourceAndType = new Map<string, Array<StixObject>>();
  for (const obj of objects) {
    if (obj['type'] !== 'relationship') {
      continue;
    }
    const sourceRef = getString(obj, 'source_ref');
    const relationshipType = getString(obj, 'relationship_type');
    if (!sourceRef || !relationshipType) {
      continue;
    }
    const key = `${sourceRef}|${relationshipType}`;
    const bucket = relationshipsBySourceAndType.get(key);
    if (bucket) {
      bucket.push(obj);
    } else {
      relationshipsBySourceAndType.set(key, [obj]);
    }
  }

  const reportsByThreatId = new Map<string, Array<StixObject>>();
  for (const obj of objects) {
    if (obj['type'] !== 'report' || !getString(obj, 'id')) {
      continue;
    }
    for (const threatId of threatRefsOf(obj)) {
      const bucket = reportsByThreatId.get(threatId);
      if (bucket) {
        bucket.push(obj);
      } else {
        reportsByThreatId.set(threatId, [obj]);
      }
    }
  }

  return { objectsById, relationshipsBySourceAndType, reportsByThreatId };
};

// ── Parser ───────────────────────────────────────────────────────────────────────────

/** Builds one threat's entry from a graph already containing every object it needs. */
export const buildThreatEntry = (threatObj: StixObject, graph: StixGraph): ParsedThreat => {
  const { objectsById, relationshipsBySourceAndType, reportsByThreatId } = graph;
  const threatId = getStixId(threatObj);

  const targetsRelations = relationshipsBySourceAndType.get(`${threatId}|targets`) ?? [];
  const usesRelations = relationshipsBySourceAndType.get(`${threatId}|uses`) ?? [];

  // Keyed by relationship STIX id: one row per claim, never one row per (group, child) pair.
  const locations = new Map<string, ParsedLocation>();
  const sectors = new Map<string, ParsedSector>();
  const cves = new Map<string, ParsedCve>();

  for (const rel of targetsRelations) {
    const meta = extractRelationMeta(rel, objectsById);
    if (meta.stixRelationId === '') {
      continue;
    }
    const targetRef = getString(rel, 'target_ref');
    const target = targetRef ? objectsById.get(targetRef) : undefined;
    if (!target) {
      continue;
    }
    const stixId = getStixId(target);

    if (target['type'] === 'location') {
      const country = getString(target, 'country');
      // A region or continent roll-up carries no country and matches no asset location.
      if (country === null) {
        continue;
      }
      locations.set(meta.stixRelationId, { stixId, name: getString(target, 'name') ?? '', country, ...meta });
    } else if (target['type'] === 'identity' && target['identity_class'] === 'class') {
      sectors.set(meta.stixRelationId, { stixId, name: getString(target, 'name') ?? '', ...meta });
    } else if (target['type'] === 'vulnerability') {
      const cveId = getString(target, 'name');
      if (cveId && cveId.startsWith('CVE-')) {
        cves.set(meta.stixRelationId, { stixId, cveId, ...meta });
      }
    }
  }

  const techniques = new Map<string, ParsedTechnique>();
  for (const rel of usesRelations) {
    const meta = extractRelationMeta(rel, objectsById);
    if (meta.stixRelationId === '') {
      continue;
    }
    const targetRef = getString(rel, 'target_ref');
    const target = targetRef ? objectsById.get(targetRef) : undefined;
    if (!target || target['type'] !== 'attack-pattern') {
      continue;
    }
    const mitreExternalId = resolveMitreId(target);
    if (mitreExternalId === null) {
      continue;
    }
    techniques.set(meta.stixRelationId, {
      stixId: getStixId(target),
      name: getString(target, 'name') ?? '',
      mitreExternalId,
      ...meta,
    });
  }

  const malware = new Map<string, ParsedMalware>();
  for (const rel of usesRelations) {
    const targetRef = getString(rel, 'target_ref');
    const target = targetRef ? objectsById.get(targetRef) : undefined;
    if (target?.['type'] === 'malware') {
      const stixId = getStixId(target);
      malware.set(stixId, { stixId, name: getString(target, 'name') ?? '', types: getStringArray(target, 'malware_types') });
    }
  }

  const reports = (reportsByThreatId.get(threatId) ?? []).map((report): ParsedReport => ({
    stixId: getStixId(report),
    title: getString(report, 'name') ?? '',
    summary: summarize(getString(report, 'description') ?? ''),
    labels: Array.isArray(report['labels']) ? report['labels'].filter((label): label is string => typeof label === 'string') : [],
    published: toDate(report['published']),
  }));

  // The target is kept by STIX id even when the bundle does not carry it: its type is the id's own
  // prefix, and the reader resolves it against the threats ingested by then.
  const attributions = new Map<string, ParsedAttribution>();
  for (const rel of relationshipsBySourceAndType.get(`${threatId}|attributed-to`) ?? []) {
    const meta = extractRelationMeta(rel, objectsById);
    const targetStixId = getString(rel, 'target_ref');
    if (meta.stixRelationId === '' || targetStixId === null || targetStixId === threatId) {
      continue;
    }
    if (isThreatEntityType(stixTypeOfId(targetStixId))) {
      attributions.set(meta.stixRelationId, { targetStixId, ...meta });
    }
  }

  const stixType = threatObj['type'];
  return {
    threat: {
      stixId: threatId,
      entityType: isThreatEntityType(stixType) ? stixType : 'intrusion-set',
      name: getString(threatObj, 'name') ?? '',
      description: getString(threatObj, 'description'),
      mitreGroupId: resolveMitreId(threatObj),
      confidence: getNumber(threatObj, 'confidence'),
      stixCreated: toDate(threatObj['created']),
      firstSeen: toDate(threatObj['first_seen']),
      lastSeen: toDate(threatObj['last_seen']),
      primaryMotivation: getString(threatObj, 'primary_motivation'),
      resourceLevel: getString(threatObj, 'resource_level'),
      sophistication: getString(threatObj, 'sophistication'),
      objective: getString(threatObj, 'objective'),
      labels: getStringArray(threatObj, 'labels'),
      markingRefs: getStringArray(threatObj, 'object_marking_refs'),
    },
    aliases: extractAliases(threatObj),
    secondaryMotivations: extractStringList(threatObj, 'secondary_motivations'),
    goals: extractStringList(threatObj, 'goals'),
    threatActorTypes: extractStringList(threatObj, 'threat_actor_types'),
    roles: extractStringList(threatObj, 'roles'),
    attributions: [...attributions.values()],
    locations: [...locations.values()],
    sectors: [...sectors.values()],
    cves: [...cves.values()],
    techniques: [...techniques.values()],
    malware: [...malware.values()],
    reports,
  };
};

/**
 * Extracts the intrusion sets, threat actors and campaigns of a STIX 2.1 bundle (OpenCTI export).
 * Throws `NonRetryableError` if the input is not a valid bundle shape.
 */
export const parseThreatBundle = (bundle: unknown): Array<ParsedThreat> => {
  const result = bundleSchema.safeParse(bundle);
  if (!result.success) {
    throw new NonRetryableError('Invalid STIX bundle: expected an object with type "bundle" and an objects array');
  }

  const objects = result.data.objects as Array<StixObject>;
  const graph = buildStixGraph(objects);
  const threats = objects.filter((obj) => isThreatEntityType(obj['type']));
  return threats.map((obj) => buildThreatEntry(obj, graph));
};

/**
 * Builds entries for threats sharing one already-resolved subgraph (the Live Stream connector's
 * targeted fetch) instead of a full bundle: same construction, smaller graph.
 * Sharing is safe because relationship lookups are keyed on each source's own id, and the only
 * objects a shared graph adds to the by-id map are the other sources' own records, which no
 * target branch of `buildThreatEntry` accepts. That holds only while an attribution is read from
 * its relationship's `target_ref` and never by looking the target up in the graph, and a threat's
 * reports are read through `reportsByThreatId` under its own id, so a report another threat of the
 * batch cites never reaches it.
 */
export const buildThreatEntriesFromObjects = (
  threatObjs: Array<StixObject>,
  relatedObjects: Array<StixObject>,
): Array<ParsedThreat> => {
  const graph = buildStixGraph([...threatObjs, ...relatedObjects]);
  return threatObjs.map((obj) => buildThreatEntry(obj, graph));
};
