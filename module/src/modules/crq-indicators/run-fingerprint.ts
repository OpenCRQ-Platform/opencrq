import { createHash } from 'node:crypto';
import { newError } from '@app/utils';

type Hash = ReturnType<typeof createHash>;

/**
 * Map and Set hash whatever their order: they are lookups, built from rows a query may return in any
 * order. Array order is kept, since an array the engine reduces over is canonicalised before it.
 */
const feed = (hash: Hash, value: unknown): void => {
  if (value === null) {
    hash.update('n;');
    return;
  }
  switch (typeof value) {
    case 'undefined':
      hash.update('u;');
      return;
    case 'boolean':
      hash.update(value ? 't;' : 'f;');
      return;
    case 'number':
      hash.update(`d${Object.is(value, -0) ? '-0' : String(value)};`);
      return;
    case 'bigint':
      hash.update(`i${value};`);
      return;
    case 'string':
      hash.update(`s${value.length}:${value};`);
      return;
    case 'object':
      break;
    case 'function':
    case 'symbol':
      throw newError('A value cannot be fingerprinted', { type: typeof value });
  }
  if (value instanceof Date) {
    hash.update(`D${value.toISOString()};`);
    return;
  }
  if (Array.isArray(value)) {
    hash.update('[');
    for (const item of value) {
      feed(hash, item);
    }
    hash.update(']');
    return;
  }
  if (value instanceof Map) {
    hash.update(`M${unordered([...value])};`);
    return;
  }
  if (value instanceof Set) {
    hash.update(`S${unordered([...value])};`);
    return;
  }
  hash.update('{');
  for (const [key, item] of Object.entries(value).sort(([one], [other]) => (one < other ? -1 : Number(one > other)))) {
    feed(hash, key);
    feed(hash, item);
  }
  hash.update('}');
};

const unordered = (items: ReadonlyArray<unknown>): string =>
  items.map((item) => fingerprintOf(item)).sort().join(',');

/** A digest of the value it is handed, the run inputs or the result: equal digests mean equal values. */
export const fingerprintOf = (value: unknown): string => {
  const hash = createHash('sha256');
  feed(hash, value);
  return hash.digest('hex');
};
