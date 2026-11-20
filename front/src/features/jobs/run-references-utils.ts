import type { TriggeredBy } from '@app/module/client';

export type ReferenceEntityKind = 'riskScenario' | 'serviceAccount' | 'user' | 'storedFile';

export interface RunReference {
  kind: ReferenceEntityKind,
  id: string,
}

export interface ResolvedReference extends RunReference {
  label: string,
  /** The lookup settled without a name, which the reader may not see: `label` is only the id's first characters. */
  nameHidden?: boolean,
}

/** The payload key naming each entity kind, read off the run's own JSON payload. */
const REFERENCE_KEYS: ReadonlyArray<{ key: string, kind: ReferenceEntityKind }> = [
  { key: 'riskScenarioId', kind: 'riskScenario' },
  { key: 'serviceAccountId', kind: 'serviceAccount' },
  { key: 'userId', kind: 'user' },
  { key: 'storedFileId', kind: 'storedFile' },
];

const parsePayloadObject = (payload: string | null | undefined): Record<string, unknown> | null => {
  if (payload === null || payload === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed to a plain object above, indexed by the fixed keys in REFERENCE_KEYS
  return parsed as Record<string, unknown>;
};

/**
 * Reads every reference a run's payload names, by payload key rather than by job kind: a kind is
 * free to carry several of these keys, or none, and a truncated payload (marked with a trailing
 * `…`) parses to no references rather than throwing.
 */
export const parseRunReferences = (payload: string | null | undefined): Array<RunReference> => {
  const parsed = parsePayloadObject(payload);
  if (parsed === null) {
    return [];
  }
  const references: Array<RunReference> = [];
  for (const { key, kind } of REFERENCE_KEYS) {
    const value = parsed[key];
    if (typeof value === 'string' && value.length > 0) {
      references.push({ kind, id: value });
    }
  }
  return references;
};

const emptyIdSets = (): Record<ReferenceEntityKind, Set<string>> => ({
  riskScenario: new Set(),
  serviceAccount: new Set(),
  user: new Set(),
  storedFile: new Set(),
});

/** Every id a page of runs names, deduplicated and sorted per kind so the query keys stay stable. */
export const groupReferenceIdsByKind = (
  runs: ReadonlyArray<{ payload?: string | null }>,
  extraReferences: ReadonlyArray<RunReference> = [],
): Record<ReferenceEntityKind, Array<string>> => {
  const sets = emptyIdSets();
  for (const run of runs) {
    for (const reference of parseRunReferences(run.payload)) {
      sets[reference.kind].add(reference.id);
    }
  }
  for (const reference of extraReferences) {
    sets[reference.kind].add(reference.id);
  }
  return {
    riskScenario: [...sets.riskScenario].sort(),
    serviceAccount: [...sets.serviceAccount].sort(),
    user: [...sets.user].sort(),
    storedFile: [...sets.storedFile].sort(),
  };
};

/** Splits a page's ids so no single lookup call ever exceeds the `getNamesByIds` procedures' cap. */
export const NAMES_BY_IDS_CAP = 200;

export const chunkIds = (ids: ReadonlyArray<string>, size: number = NAMES_BY_IDS_CAP): Array<Array<string>> => {
  const chunks: Array<Array<string>> = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
};

const FALLBACK_LABEL_LENGTH = 8;

/** Falls back to the id's own first characters when the name is missing or has not resolved yet. */
export const resolveRunReference = (
  reference: RunReference,
  namesById: ReadonlyMap<string, string>,
  namesSettled: boolean = false,
): ResolvedReference => {
  const name = namesById.get(reference.id);
  return name === undefined
    ? { ...reference, label: reference.id.slice(0, FALLBACK_LABEL_LENGTH), nameHidden: namesSettled }
    : { ...reference, label: name };
};

/**
 * `triggeredById` names a user or a service account only for these two triggers (`originTrigger`
 * in `module/src/security/policy.ts`); every other value either carries no id or, for `system`
 * answering an absorbed ask, one naming a run rather than an entity, which the caller renders on
 * its own.
 */
export const triggeredByReference = (triggeredBy: TriggeredBy, triggeredById: string | null): RunReference | null => {
  if (triggeredById === null) {
    return null;
  }
  if (triggeredBy === 'user') {
    return { kind: 'user', id: triggeredById };
  }
  if (triggeredBy === 'connector') {
    return { kind: 'serviceAccount', id: triggeredById };
  }
  return null;
};
