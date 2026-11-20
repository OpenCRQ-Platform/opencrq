import { describe, expect, it } from 'vitest';
import type { EventOrigin } from './policy';
import { originServiceAccountId } from './policy';

describe('originServiceAccountId', () => {
  it('returns the service account behind a connector origin', () => {
    expect(originServiceAccountId({ type: 'connector', serviceAccountId: 'sa-1', tenantId: 'tenant-1' })).toBe('sa-1');
  });

  it.each<[string, EventOrigin]>([
    ['client', { type: 'client', userId: 'user-1', tenantId: 'tenant-1' }],
    ['platform', { type: 'platform', userId: 'user-1' }],
    ['job', { type: 'job', tenantId: 'tenant-1', jobKind: 'sync', interactive: false }],
    ['system', { type: 'system' }],
    ['auth', { type: 'auth' }],
  ])('returns nothing for a %s origin', (_type, origin) => {
    expect(originServiceAccountId(origin)).toBeUndefined();
  });
});
