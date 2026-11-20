import { describe, expect, it, vi } from 'vitest';
import { PAYLOAD_CHAR_CAP, serialisePayload } from './run-contract';

// run-contract.ts reads app config at import time; only its schemas/helpers are needed here.
vi.mock('../../../config', () => ({ config: () => ({}) }));

describe('serialisePayload', () => {
  it('renders null for an empty payload', () => {
    expect(serialisePayload({})).toBeNull();
  });

  it('sorts keys regardless of insertion order, so two runs of the same kind diff cleanly', () => {
    const inOrder = serialisePayload({ b: 2, a: 1 });
    const outOfOrder = serialisePayload({ a: 1, b: 2 });
    expect(inOrder).toBe(outOfOrder);
    expect(inOrder).toBe('{"a":1,"b":2}');
  });

  it('redacts a value assigned to a sensitive key', () => {
    const result = serialisePayload({ apiKey: 'sk-super-secret-value', userId: 'a-b-c' });
    expect(result).not.toContain('sk-super-secret-value');
    expect(result).toContain('[redacted]');
    expect(result).toContain('a-b-c');
  });

  it('truncates past the cap and marks it with an ellipsis suffix', () => {
    const result = serialisePayload({ note: 'x'.repeat(PAYLOAD_CHAR_CAP * 2) });
    expect(result).not.toBeNull();
    expect(result?.endsWith('…')).toBe(true);
    expect(result?.length).toBe(PAYLOAD_CHAR_CAP + 1);
  });
});
