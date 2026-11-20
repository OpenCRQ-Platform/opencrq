import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

export type OpenctiStream = RouterOutputs['opencti']['listStreams'][number];
export type StreamFilterGroup = NonNullable<OpenctiStream['filterGroup']>;
export type StreamFilterClause = StreamFilterGroup['filters'][number];
export type StreamVerdict = OpenctiStream['verdict'];
export type StreamRelationship = OpenctiStream['missingRelationships'][number];

/**
 * What a stream's filter holds, in the one line the picker shows under each name. `entityTypes`
 * carries the types the filter admits; `keys` the other things it selects on. `admits-nothing` and
 * `indeterminate` are the two answers that must not be turned into a list of types: the first is a
 * filter no object satisfies, the second one whose type conditions this summary cannot state.
 */
export interface StreamFilterPrecis {
  kind: 'absent' | 'unreadable' | 'unconstrained' | 'entity-types' | 'other-keys' | 'admits-nothing' | 'indeterminate',
  entityTypes: Array<string>,
  keys: Array<string>,
  /** True when entity types are the whole filter, so nothing else can narrow what arrives. */
  exhaustive: boolean,
}

const collectClauses = (group: StreamFilterGroup): Array<StreamFilterClause> => [
  ...group.filters,
  ...group.filterGroups.flatMap(collectClauses),
];

const unique = (values: Array<string>): Array<string> => [...new Set(values)];

/** `any` is no constraint on the type at all, an empty `types` a constraint nothing satisfies. */
type AdmittedTypes = { kind: 'any' } | { kind: 'unknown' } | { kind: 'types', values: Array<string> };

const ANY: AdmittedTypes = { kind: 'any' };
const UNKNOWN: AdmittedTypes = { kind: 'unknown' };

/** Reads a clause's shape as the back's `clauseAdmission` does; what a type name means is the verdict's alone. */
const clauseTypes = (clause: StreamFilterClause): AdmittedTypes => {
  if (clause.key[0] !== 'entity_type') {
    return ANY;
  }
  if (clause.key.length !== 1 || clause.operator !== 'eq' || clause.values.length === 0) {
    return UNKNOWN;
  }
  return clause.mode === 'and' && clause.values.length > 1 ? UNKNOWN : { kind: 'types', values: clause.values };
};

const intersection = (parts: Array<AdmittedTypes>): AdmittedTypes => {
  const sets = parts.filter((part) => part.kind === 'types');
  // An empty set settles the conjunction whatever the other parts turn out to admit.
  if (sets.some((set) => set.values.length === 0)) {
    return { kind: 'types', values: [] };
  }
  if (parts.some((part) => part.kind === 'unknown')) {
    return UNKNOWN;
  }
  const [first, ...rest] = sets;
  if (first === undefined) {
    return ANY;
  }
  return { kind: 'types', values: rest.reduce((kept, set) => kept.filter((value) => set.values.includes(value)), first.values) };
};

const union = (parts: Array<AdmittedTypes>): AdmittedTypes => {
  if (parts.some((part) => part.kind === 'any')) {
    return ANY;
  }
  if (parts.some((part) => part.kind === 'unknown')) {
    return UNKNOWN;
  }
  return { kind: 'types', values: unique(parts.flatMap((part) => (part.kind === 'types' ? part.values : []))) };
};

const groupTypes = (group: StreamFilterGroup): AdmittedTypes => {
  const parts = [...group.filters.map(clauseTypes), ...group.filterGroups.map(groupTypes)];
  if (parts.length === 0) {
    return ANY;
  }
  return group.mode === 'and' ? intersection(parts) : union(parts);
};

/** The verdict has the last word on what a type name means, so this line never out-claims it. */
export const streamFilterPrecis = (
  filterGroup: StreamFilterGroup | null,
  rawFilter: string | null,
  verdict: StreamVerdict,
): StreamFilterPrecis => {
  const empty = { entityTypes: [], keys: [], exhaustive: false };
  if (filterGroup === null) {
    return { ...empty, kind: rawFilter === null ? 'absent' : 'unreadable' };
  }
  const clauses = collectClauses(filterGroup);
  if (clauses.length === 0) {
    return { ...empty, kind: 'unconstrained' };
  }
  const otherKeys = unique(clauses.filter((clause) => clause.key[0] !== 'entity_type').map((clause) => clause.key[0] ?? ''));
  const admitted = groupTypes(filterGroup);
  if (admitted.kind === 'unknown') {
    return { ...empty, kind: 'indeterminate', keys: otherKeys };
  }
  if (admitted.kind === 'any') {
    // Type clauses that leave every type through are a shape this line has no short reading for.
    const namesATypeAnyway = clauses.some((clause) => clause.key[0] === 'entity_type');
    return { ...empty, kind: namesATypeAnyway ? 'indeterminate' : 'other-keys', keys: otherKeys };
  }
  // The verdict abstains on a type value it cannot classify (`Stix-Domain-Object` extends to
  // intrusion sets, a container ships its contents), so a line ruling on the types would read as
  // the judgement the chip beside it has just refused.
  if (verdict === 'undecidable') {
    return { ...empty, kind: 'indeterminate', keys: otherKeys };
  }
  if (admitted.values.length === 0) {
    return { ...empty, kind: 'admits-nothing', keys: otherKeys };
  }
  return {
    kind: 'entity-types',
    entityTypes: admitted.values,
    keys: otherKeys,
    exhaustive: otherKeys.length === 0,
  };
};

export type StreamAlarm = 'incompatible' | 'no_actors' | 'stopped' | 'no_history' | 'missing';

/**
 * The one fact worth a banner, or none. A verdict outranks a missing replay because a stream that
 * carries no threat actor is not made useful by replaying its history. Anything the check could not
 * judge raises nothing at all: an abstention is not an alarm, and a banner seen on every visit is
 * dismissed on sight.
 */
export const streamAlarm = (stream: OpenctiStream | null): StreamAlarm | null => {
  if (stream === null) {
    return null;
  }
  if (stream.verdict === 'incompatible' || stream.verdict === 'no_actors' || stream.verdict === 'stopped') {
    return stream.verdict;
  }
  return stream.replaysHistory ? null : 'no_history';
};

/** The stream the connector is bound to, found in a listing that may not have arrived. */
export const findConfiguredStream = (
  streams: Array<OpenctiStream> | undefined,
  streamId: string | null,
): OpenctiStream | null => {
  if (streamId === null) {
    return null;
  }
  return streams?.find((stream) => stream.id === streamId) ?? null;
};

/**
 * The alarm the bound stream raises, from a listing that may not have arrived. A listing that did
 * arrive without the bound stream in it is the loudest case of all and must not be confused with
 * the one that has not arrived: the stream is gone from OpenCTI, so nothing will ever arrive again.
 */
export const configuredStreamAlarm = (
  streams: Array<OpenctiStream> | undefined,
  streamId: string | null,
): StreamAlarm | null => {
  if (streamId === null || streams === undefined) {
    return null;
  }
  const stream = findConfiguredStream(streams, streamId);
  return stream === null ? 'missing' : streamAlarm(stream);
};

/** Pretty-prints the stream's own filter for the raw view, leaving it verbatim when it is not JSON. */
export const formatRawFilter = (rawFilter: string): string => {
  try {
    return JSON.stringify(JSON.parse(rawFilter), null, 2);
  } catch {
    return rawFilter;
  }
};
