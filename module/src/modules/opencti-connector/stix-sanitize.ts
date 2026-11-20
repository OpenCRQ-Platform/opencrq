export interface SanitizedStixObject {
  data: Record<string, unknown>,
  changedStrings: number,
  droppedKeys: number,
}

interface Walked<T> {
  value: T,
  changed: number,
  dropped: number,
}

const NULL_BYTE = '\u0000';

const stripNullBytes = (value: string): string => value.replaceAll(NULL_BYTE, '');

const isRecord = (node: unknown): node is Record<string, unknown> =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

const unchanged = <T>(value: T): Walked<T> => ({ value, changed: 0, dropped: 0 });

const containsNullByte = (node: unknown): boolean => {
  if (typeof node === 'string') {
    return node.includes(NULL_BYTE);
  }
  if (Array.isArray(node)) {
    return node.some((item: unknown) => containsNullByte(item));
  }
  if (isRecord(node)) {
    return Object.keys(node).some((key) => key.includes(NULL_BYTE) || containsNullByte(node[key]));
  }
  return false;
};

const walkValue = (node: unknown): Walked<unknown> => {
  if (typeof node === 'string') {
    const stripped = stripNullBytes(node);
    return stripped === node ? unchanged(node) : { value: stripped, changed: 1, dropped: 0 };
  }
  if (Array.isArray(node)) {
    return walkArray(node);
  }
  if (isRecord(node)) {
    return walkRecord(node);
  }
  return unchanged(node);
};

const walkArray = (node: Array<unknown>): Walked<Array<unknown>> => {
  let next: Array<unknown> | null = null;
  let changed = 0;
  let dropped = 0;
  for (let index = 0; index < node.length; index += 1) {
    const walked = walkValue(node[index]);
    if (walked.changed === 0 && walked.dropped === 0) {
      continue;
    }
    next ??= [...node];
    next[index] = walked.value;
    changed += walked.changed;
    dropped += walked.dropped;
  }
  return next === null ? unchanged(node) : { value: next, changed, dropped };
};

const walkRecord = (node: Record<string, unknown>): Walked<Record<string, unknown>> => {
  const nextEntries: Array<[string, unknown]> = [];
  const takenKeys = new Set<string>();
  let rebuilt = false;
  let changed = 0;
  let dropped = 0;
  for (const [key, item] of Object.entries(node)) {
    const strippedKey = stripNullBytes(key);
    const walked = walkValue(item);
    rebuilt ||= strippedKey !== key || walked.changed > 0 || walked.dropped > 0;
    // Two keys differing only by null bytes collapse onto one: the first wins, rather than the
    // later value silently replacing it.
    if (takenKeys.has(strippedKey)) {
      dropped += 1;
      continue;
    }
    takenKeys.add(strippedKey);
    changed += walked.changed + (strippedKey === key ? 0 : 1);
    dropped += walked.dropped;
    nextEntries.push([strippedKey, walked.value]);
  }
  // `Object.fromEntries`, never assignment: a key of `__proto__` reaches the prototype setter that
  // way, and the value lands on the prototype instead of on the object.
  return rebuilt ? { value: Object.fromEntries(nextEntries), changed, dropped } : unchanged(node);
};

/**
 * Postgres refuses U+0000 inside a `jsonb` value, so a mirrored STIX object carrying one makes its
 * upsert throw and, to the stream consumer, the whole connection look failed. Nothing downstream
 * reads the byte, so it is dropped rather than escaped, in keys as in values.
 *
 * Every branch that needed no change comes back by reference, the object itself included.
 */
export const sanitizeStixNullBytes = (data: Record<string, unknown>): SanitizedStixObject => {
  if (!containsNullByte(data)) {
    return { data, changedStrings: 0, droppedKeys: 0 };
  }
  const walked = walkRecord(data);
  return { data: walked.value, changedStrings: walked.changed, droppedKeys: walked.dropped };
};
