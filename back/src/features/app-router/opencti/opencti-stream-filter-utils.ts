import { z } from 'zod';

export interface StreamFilterClause {
  key: Array<string>,
  operator: string,
  mode: 'and' | 'or',
  values: Array<string>,
}

export interface StreamFilterGroup {
  mode: 'and' | 'or',
  filters: Array<StreamFilterClause>,
  filterGroups: Array<StreamFilterGroup>,
}

export const streamFilterGroupSchema: z.ZodType<StreamFilterGroup> = z.lazy(() => z.object({
  mode: z.enum(['and', 'or']),
  filters: z.array(z.object({
    key: z.array(z.string()),
    operator: z.string(),
    mode: z.enum(['and', 'or']),
    values: z.array(z.string()),
  })),
  filterGroups: z.array(streamFilterGroupSchema),
}));

export const STREAM_VERDICTS = ['delivers', 'incompatible', 'no_actors', 'stopped', 'undecidable'] as const;

export type StreamVerdict = (typeof STREAM_VERDICTS)[number];

const ENTITY_PARENTS = ['Stix-Domain-Object', 'Stix-Core-Object'];

const RELATIONSHIP_PARENTS = ['stix-core-relationship', 'Stix-Core-Relationship', 'basic-relationship'];

/**
 * A value in `narrowedBy` is neither an admission nor a refusal: a filter naming `Country` carries
 * some locations and not others.
 */
const TYPE_FACETS: Record<string, { admittedBy: Array<string>, narrowedBy: Array<string> }> = {
  'Intrusion-Set': { admittedBy: ['Intrusion-Set', ...ENTITY_PARENTS], narrowedBy: [] },
  'Threat-Actor-Group': { admittedBy: ['Threat-Actor-Group', 'Threat-Actor', ...ENTITY_PARENTS], narrowedBy: [] },
  'Threat-Actor-Individual': { admittedBy: ['Threat-Actor-Individual', 'Threat-Actor', ...ENTITY_PARENTS], narrowedBy: [] },
  Campaign: { admittedBy: ['Campaign', ...ENTITY_PARENTS], narrowedBy: [] },
  'Attack-Pattern': { admittedBy: ['Attack-Pattern', ...ENTITY_PARENTS], narrowedBy: [] },
  Location: {
    admittedBy: ['Location', ...ENTITY_PARENTS],
    narrowedBy: ['Region', 'Country', 'City', 'Administrative-Area', 'Position'],
  },
  Sector: { admittedBy: ['Sector', 'Identity', ...ENTITY_PARENTS], narrowedBy: [] },
  Vulnerability: { admittedBy: ['Vulnerability', ...ENTITY_PARENTS], narrowedBy: [] },
  targets: { admittedBy: ['targets', ...RELATIONSHIP_PARENTS], narrowedBy: [] },
  uses: { admittedBy: ['uses', ...RELATIONSHIP_PARENTS], narrowedBy: [] },
  'attributed-to': { admittedBy: ['attributed-to', ...RELATIONSHIP_PARENTS], narrowedBy: [] },
};

/**
 * Types this check is willing to rule on. Anything else falls through to `unknown` rather than a
 * refusal, which is what an abstract root (`Stix-Object`) and a container that ships its contents
 * (`Report`) require.
 */
const KNOWN_TYPES = new Set([
  'Intrusion-Set', 'Location', 'Identity', ...ENTITY_PARENTS, ...RELATIONSHIP_PARENTS,
  'Attack-Pattern', 'Campaign', 'Channel', 'Course-Of-Action', 'Data-Component', 'Data-Source',
  'Event', 'Indicator', 'Individual', 'Infrastructure', 'Language', 'Malware', 'Malware-Analysis',
  'Narrative', 'Organization', 'Position', 'Region', 'Country', 'City', 'Administrative-Area',
  'Sector', 'System', 'Threat-Actor', 'Threat-Actor-Group', 'Threat-Actor-Individual', 'Tool', 'Vulnerability',
  'Artifact', 'Autonomous-System', 'Directory', 'Domain-Name', 'Email-Addr', 'Email-Message',
  'StixFile', 'Hostname', 'IPv4-Addr', 'IPv6-Addr', 'Mac-Addr', 'Mutex', 'Network-Traffic',
  'Process', 'Software', 'Url', 'User-Account', 'User-Agent', 'Windows-Registry-Key',
  'Marking-Definition', 'Label', 'External-Reference', 'Kill-Chain-Phase',
  'targets', 'uses', 'indicates', 'mitigates', 'attributed-to', 'located-at', 'related-to',
  'part-of', 'derived-from', 'based-on', 'compromises', 'originates-from', 'investigates',
  'remediates', 'belongs-to', 'communicates-with', 'amplifies', 'subnarrative-of',
  'subtechnique-of', 'revoked-by', 'authored-by', 'publishes', 'delivers', 'drops', 'exploits',
  'hosts', 'owns', 'controls', 'has', 'participates-in', 'cooperates-with', 'employed-by',
  'resides-in', 'citizen-of', 'national-of', 'detects', 'variant-of', 'impersonates',
  'duplicate-of', 'consists-of', 'resolves-to', 'downloads', 'beacons-to', 'exfiltrates-to',
]);

type Admission = 'yes' | 'no' | 'unknown';

/**
 * One object the parser needs. An entity leaves both ends unset, which is what makes a clause on an
 * end refuse it, as OpenCTI's own testers do.
 */
interface Candidate {
  entityType: string,
  fromType?: string,
  toType?: string,
}

const CLAUSE_FACET: Record<string, keyof Candidate> = {
  entity_type: 'entityType',
  fromTypes: 'fromType',
  toTypes: 'toType',
};

const STREAM_ACTORS = ['intrusion_set', 'threat_actor_group', 'threat_actor_individual', 'campaign'] as const;

type StreamActor = (typeof STREAM_ACTORS)[number];

const ACTOR_ENTITY_TYPE: Record<StreamActor, string> = {
  intrusion_set: 'Intrusion-Set',
  threat_actor_group: 'Threat-Actor-Group',
  threat_actor_individual: 'Threat-Actor-Individual',
  campaign: 'Campaign',
};

const ACTOR_CLAIMS = [
  { claim: 'uses_technique', entityType: 'uses', toType: 'Attack-Pattern' },
  { claim: 'targets_location', entityType: 'targets', toType: 'Location' },
  { claim: 'targets_sector', entityType: 'targets', toType: 'Sector' },
  { claim: 'targets_vulnerability', entityType: 'targets', toType: 'Vulnerability' },
] as const;

export const STREAM_RELATIONSHIPS = [
  ...STREAM_ACTORS.flatMap((actor) => ACTOR_CLAIMS.map(({ claim }) => `${actor}_${claim}` as const)),
  'attributed_to' as const,
];

export type StreamRelationship = (typeof STREAM_RELATIONSHIPS)[number];

/** A relationship the parser reads, required only while the filter admits every actor it joins. */
interface Requirement {
  key: StreamRelationship,
  actors: Array<StreamActor>,
  candidate: Candidate,
}

const CLAIM_REQUIREMENTS: Array<Requirement> = STREAM_ACTORS.flatMap((actor) => ACTOR_CLAIMS.map(({ claim, entityType, toType }) => ({
  key: `${actor}_${claim}` as const,
  actors: [actor],
  candidate: { entityType, fromType: ACTOR_ENTITY_TYPE[actor], toType },
})));

/** The only directions STIX 2.1 allows an `attributed-to` in between two actor types. */
const ATTRIBUTION_REQUIREMENTS: Array<Requirement> = ([
  ['campaign', 'intrusion_set'],
  ['campaign', 'threat_actor_group'],
  ['campaign', 'threat_actor_individual'],
  ['intrusion_set', 'threat_actor_group'],
  ['intrusion_set', 'threat_actor_individual'],
] as const).map(([from, to]) => ({
  key: 'attributed_to' as const,
  actors: [from, to],
  candidate: { entityType: 'attributed-to', fromType: ACTOR_ENTITY_TYPE[from], toType: ACTOR_ENTITY_TYPE[to] },
}));

interface RawGroup {
  mode?: string,
  filters?: Array<{ key: string | Array<string>, operator?: string, mode?: string, values?: Array<unknown> }>,
  filterGroups?: Array<RawGroup>,
}

const rawGroupSchema: z.ZodType<RawGroup> = z.lazy(() => z.object({
  mode: z.string().optional(),
  filters: z.array(z.object({
    key: z.union([z.string(), z.array(z.string())]),
    operator: z.string().optional(),
    mode: z.string().optional(),
    values: z.array(z.unknown()).optional(),
  })).optional(),
  filterGroups: z.array(rawGroupSchema).optional(),
}));

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const asMode = (value: string | undefined, fallback: 'and' | 'or'): 'and' | 'or' | null => {
  if (value === undefined) {
    return fallback;
  }
  const lowered = value.toLowerCase();
  return lowered === 'and' || lowered === 'or' ? lowered : null;
};

const normaliseGroup = (raw: RawGroup): StreamFilterGroup | null => {
  const mode = asMode(raw.mode, 'and');
  if (mode === null) {
    return null;
  }
  const filters: Array<StreamFilterClause> = [];
  for (const rawClause of raw.filters ?? []) {
    const clauseMode = asMode(rawClause.mode, 'or');
    const values = rawClause.values ?? [];
    if (clauseMode === null || !values.every(isPrimitive)) {
      return null;
    }
    filters.push({
      key: Array.isArray(rawClause.key) ? rawClause.key : [rawClause.key],
      operator: rawClause.operator ?? 'eq',
      mode: clauseMode,
      values: values.map(String),
    });
  }
  const filterGroups: Array<StreamFilterGroup> = [];
  for (const rawChild of raw.filterGroups ?? []) {
    const child = normaliseGroup(rawChild);
    if (child === null) {
      return null;
    }
    filterGroups.push(child);
  }
  return { mode, filters, filterGroups };
};

/**
 * Reads a stream's filter into the shape both the check and the renderer consume. Null means the
 * filter is there but this platform could not read it, which the caller must tell apart from a
 * stream carrying no filter at all: one is a verdict of `undecidable`, the other is no constraint.
 */
export const parseFilterGroup = (raw: string | null | undefined): StreamFilterGroup | null => {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return null;
  }
  try {
    const parsed = rawGroupSchema.safeParse(JSON.parse(raw));
    return parsed.success ? normaliseGroup(parsed.data) : null;
  } catch {
    // Nesting deep enough to exhaust the stack throws out of the schema walk, and one such filter
    // would otherwise take the whole listing down with it rather than this one stream's verdict.
    return null;
  }
};

export const hasAnyClause = (group: StreamFilterGroup): boolean =>
  group.filters.length > 0 || group.filterGroups.some(hasAnyClause);

const typeAdmission = (candidateType: string, clause: StreamFilterClause): Admission => {
  // `and` over several types asks for one object of two types at once, which no object satisfies
  // and this check has no business ruling on.
  if (clause.values.length === 0 || (clause.mode === 'and' && clause.values.length > 1)) {
    return 'unknown';
  }
  const facets = TYPE_FACETS[candidateType];
  if (facets === undefined) {
    return 'unknown';
  }
  const parts = clause.values.map((value): Admission => {
    if (facets.admittedBy.includes(value)) {
      return 'yes';
    }
    if (facets.narrowedBy.includes(value)) {
      return 'unknown';
    }
    return KNOWN_TYPES.has(value) ? 'no' : 'unknown';
  });
  if (parts.includes('yes')) {
    return 'yes';
  }
  return parts.every((part) => part === 'no') ? 'no' : 'unknown';
};

const clauseAdmission = (clause: StreamFilterClause, candidate: Candidate): Admission => {
  const facet = clause.key.length === 1 && clause.operator === 'eq' ? CLAUSE_FACET[clause.key[0] ?? ''] : undefined;
  if (facet === undefined) {
    return 'unknown';
  }
  const candidateType = candidate[facet];
  return candidateType === undefined ? 'no' : typeAdmission(candidateType, clause);
};

export const groupAdmission = (group: StreamFilterGroup, candidate: Candidate): Admission => {
  const parts = [
    ...group.filters.map((clause) => clauseAdmission(clause, candidate)),
    ...group.filterGroups.map((child) => groupAdmission(child, candidate)),
  ];
  if (parts.length === 0) {
    return 'yes';
  }
  if (group.mode === 'and') {
    // One conjunct that admits nothing settles the whole group, whatever the others say.
    return parts.includes('no') ? 'no' : (parts.every((part) => part === 'yes') ? 'yes' : 'unknown');
  }
  return parts.includes('yes') ? 'yes' : (parts.every((part) => part === 'no') ? 'no' : 'unknown');
};

interface FilterAssessment {
  verdict: Exclude<StreamVerdict, 'stopped'>,
  missing: Array<StreamRelationship>,
}

/**
 * A refused relationship is a proven loss only when the filter certainly admits every actor it
 * joins, or when no actor is certainly admitted and each one it might admit loses a claim of its
 * own: then every reading of the filter truncates the import. Short of that, it abstains.
 */
const assessFilter = (group: StreamFilterGroup): FilterAssessment => {
  const admission = new Map(STREAM_ACTORS.map((actor) => [actor, groupAdmission(group, { entityType: ACTOR_ENTITY_TYPE[actor] })]));
  const admitted = STREAM_ACTORS.filter((actor) => admission.get(actor) !== 'no');
  if (admitted.length === 0) {
    return { verdict: 'no_actors', missing: [] };
  }
  const judged = [...CLAIM_REQUIREMENTS, ...ATTRIBUTION_REQUIREMENTS]
    .filter((requirement) => requirement.actors.every((actor) => admitted.includes(actor)))
    .map((requirement) => ({
      ...requirement,
      admission: groupAdmission(group, requirement.candidate),
      certain: requirement.actors.every((actor) => admission.get(actor) === 'yes'),
    }));
  const refused = judged.filter((requirement) => requirement.admission === 'no');
  const anyCertainActor = admitted.some((actor) => admission.get(actor) === 'yes');
  const everyActorLosesAClaim = admitted.every((actor) =>
    refused.some((requirement) => requirement.actors.length === 1 && requirement.actors[0] === actor));
  const proven = anyCertainActor ? refused.filter((requirement) => requirement.certain) : (everyActorLosesAClaim ? refused : []);
  if (proven.length > 0) {
    return { verdict: 'incompatible', missing: [...new Set(proven.map((requirement) => requirement.key))] };
  }
  // An actor the filter may or may not admit is harmless once every relationship it joins is admitted.
  const decided = anyCertainActor && judged.every((requirement) => requirement.admission === 'yes');
  return { verdict: decided ? 'delivers' : 'undecidable', missing: [] };
};

/**
 * A verdict of `incompatible` says only that some of the parser's relationships are missing, so the
 * notice has to name which: one claiming all of them would overstate what is lost.
 */
export const missingRelationships = (group: StreamFilterGroup): Array<StreamRelationship> => assessFilter(group).missing;

/**
 * The filter is the whole contract: the connector consumes the stream without dependencies, so a
 * relationship the filter rejects is never published and no end of it drags it in. A filter
 * admitting actors alone therefore yields bare threats, which is `incompatible` and not
 * `no_actors`.
 */
export const streamVerdict = (stream: {
  streamLive: boolean,
  rawFilter: string | null,
  filterGroup: StreamFilterGroup | null,
}): StreamVerdict => {
  if (!stream.streamLive) {
    return 'stopped';
  }
  const { filterGroup } = stream;
  if (filterGroup === null) {
    return stream.rawFilter === null ? 'delivers' : 'undecidable';
  }
  return assessFilter(filterGroup).verdict;
};

export interface DescribedStream {
  id: string,
  name: string,
  description: string | null,
  rawFilter: string | null,
  filterGroup: StreamFilterGroup | null,
  verdict: StreamVerdict,
  missingRelationships: Array<StreamRelationship>,
  replaysHistory: boolean,
}

export const describeStream = (node: {
  id: string,
  name: string,
  description?: string | null,
  filters?: string | null,
  origin_filters?: string | null,
  stream_live?: boolean | null,
}): DescribedStream => {
  const rawFilter = node.filters?.trim() ? node.filters : null;
  const filterGroup = parseFilterGroup(rawFilter);
  const streamLive = node.stream_live !== false;
  const rawOriginFilter = node.origin_filters?.trim() ? node.origin_filters : null;
  const originFilters = parseFilterGroup(rawOriginFilter);
  const verdict = streamVerdict({ streamLive, rawFilter, filterGroup });
  return {
    id: node.id,
    name: node.name,
    description: node.description ?? null,
    rawFilter,
    filterGroup,
    verdict,
    missingRelationships: verdict === 'incompatible' && filterGroup !== null ? missingRelationships(filterGroup) : [],
    // Mirrors the platform's own `isFilterGroupNotEmpty` guard: an origin filter group with no
    // clause in it leaves the history replay alone. An origin filter this platform cannot read is
    // reported as suppressing the replay, never as leaving it.
    replaysHistory: rawOriginFilter === null || (originFilters !== null && !hasAnyClause(originFilters)),
  };
};

/**
 * A fixed locale rather than the server's own: the order a deployment presents its streams in must
 * not depend on where the platform happens to run.
 */
const STREAM_NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export const describeStreams = (nodes: Array<Parameters<typeof describeStream>[0]>): Array<DescribedStream> =>
  nodes
    .map(describeStream)
    .sort((left, right) => STREAM_NAME_COLLATOR.compare(left.name, right.name));
