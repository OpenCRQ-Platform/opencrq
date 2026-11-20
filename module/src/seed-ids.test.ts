import { describe, expect, it } from 'vitest';
import { deriveSeedId } from './seed-ids';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KEY_A = '0198f2a1-8a1b-7c3d-9f04-1a2b3c4d5e6f';
const KEY_B = '0198f2a1-8a1b-7c3d-9f04-1a2b3c4d5e70';
const PARENT_A = 'daefedbd-15a9-4bf8-bcaf-14b92d25e2bd';
const PARENT_B = 'f0eea3dd-d091-4928-89b1-4f48fa1c9b3b';

describe('deriveSeedId', () => {
  it('returns the same identifier for the same key and parent', () => {
    expect(deriveSeedId(KEY_A, PARENT_A)).toBe(deriveSeedId(KEY_A, PARENT_A));
  });

  it('returns a different identifier per key under the same parent', () => {
    expect(deriveSeedId(KEY_A, PARENT_A)).not.toBe(deriveSeedId(KEY_B, PARENT_A));
  });

  it('returns a different identifier per parent for the same key', () => {
    expect(deriveSeedId(KEY_A, PARENT_A)).not.toBe(deriveSeedId(KEY_A, PARENT_B));
  });

  it('accepts a key that is not a UUID', () => {
    expect(deriveSeedId('5.1', PARENT_A)).toBe(deriveSeedId('5.1', PARENT_A));
    expect(deriveSeedId('5.1', PARENT_A)).not.toBe(deriveSeedId('5.2', PARENT_A));
  });

  it('returns a well-formed UUID', () => {
    expect(deriveSeedId(KEY_A, PARENT_A)).toMatch(UUID_PATTERN);
  });
});
