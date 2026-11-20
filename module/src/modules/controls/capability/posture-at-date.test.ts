import { describe, expect, it } from 'vitest';
import type { DeclaredPostures, PostureEventAfter } from './posture-at-date';
import { rewindScopePosture, samePosture } from './posture-at-date';

const SCOPE = 'scope-1';

const declared = (overrides: Partial<DeclaredPostures> = {}): DeclaredPostures => ({
  tenant: new Map([['edr', { strengthRung: 'L2', coverageBucket: 'L2' }]]),
  scope: new Map(),
  ...overrides,
});

const tenantEvent = (
  capabilityId: string,
  oldStrength: PostureEventAfter['oldStrength'],
  oldCoverage: PostureEventAfter['oldCoverage'],
): PostureEventAfter => ({ capabilityId, organizationId: null, oldStrength, oldCoverage });

const scopeEvent = (
  capabilityId: string,
  oldStrength: PostureEventAfter['oldStrength'],
  oldCoverage: PostureEventAfter['oldCoverage'],
): PostureEventAfter => ({ capabilityId, organizationId: SCOPE, oldStrength, oldCoverage });

describe('rewindScopePosture', () => {
  it('answers today\'s posture when nothing was logged since the cutoff', () => {
    const posture = rewindScopePosture(['edr', 'mfa'], declared(), []);
    expect(posture.get('edr')).toMatchObject({ strengthRung: 'L2', coverageBucket: 'L2' });
    expect(posture.get('mfa')).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0' });
  });

  it('reads the old value of the first tenant line since the cutoff', () => {
    const posture = rewindScopePosture(['edr'], declared(), [tenantEvent('edr', 'L1', 'L1')]);
    expect(posture.get('edr')).toMatchObject({ strengthRung: 'L1', coverageBucket: 'L1' });
  });

  it('reads a tenant line with no old value as a control nobody had declared, L0 and L0', () => {
    const posture = rewindScopePosture(['edr'], declared(), [tenantEvent('edr', null, null)]);
    expect(posture.get('edr')).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0' });
  });

  it('reads a scope line with no old value as no override, following the tenant', () => {
    const posture = rewindScopePosture(
      ['edr'],
      declared({ scope: new Map([['edr', { strengthRung: null, coverageBucket: 'L3' }]]) }),
      [scopeEvent('edr', null, null)],
    );
    expect(posture.get('edr')).toMatchObject({ strengthRung: 'L2', coverageBucket: 'L2', coverageSource: 'tenant' });
  });

  it('lets a null axis of an old scope value inherit the tenant\'s value at the same date', () => {
    const posture = rewindScopePosture(
      ['edr'],
      declared(),
      [tenantEvent('edr', 'L1', 'L1'), scopeEvent('edr', 'L3', null)],
    );
    expect(posture.get('edr')).toMatchObject({
      strengthRung: 'L3',
      strengthSource: 'scope',
      coverageBucket: 'L1',
      coverageSource: 'tenant',
    });
  });

  /* A deleted override logs both new values null and leaves no row, so only its old values remember it. */
  it('reads a deleted override as it stood before the deletion, and as gone after it', () => {
    const today = declared();
    const deletion = scopeEvent('edr', 'L3', null);

    expect(rewindScopePosture(['edr'], today, [deletion]).get('edr')).toMatchObject({
      strengthRung: 'L3',
      strengthSource: 'scope',
      coverageBucket: 'L2',
    });
    expect(rewindScopePosture(['edr'], today, []).get('edr')).toMatchObject({
      strengthRung: 'L2',
      strengthSource: 'tenant',
      coverageBucket: 'L2',
    });
  });

  it('keeps today\'s override when only the tenant level moved since the cutoff', () => {
    const posture = rewindScopePosture(
      ['edr'],
      declared({ scope: new Map([['edr', { strengthRung: 'L3', coverageBucket: null }]]) }),
      [tenantEvent('edr', 'L1', 'L1')],
    );
    expect(posture.get('edr')).toMatchObject({ strengthRung: 'L3', coverageBucket: 'L1' });
  });
});

describe('samePosture', () => {
  it('compares the strength and the coverage', () => {
    expect(samePosture({ strengthRung: 'L2', coverageBucket: 'L2' }, { strengthRung: 'L2', coverageBucket: 'L2' })).toBe(true);
    expect(samePosture({ strengthRung: 'L2', coverageBucket: 'L2' }, { strengthRung: 'L2', coverageBucket: 'L3' })).toBe(false);
    expect(samePosture({ strengthRung: 'L2', coverageBucket: 'L2' }, { strengthRung: 'L3', coverageBucket: 'L2' })).toBe(false);
  });
});
