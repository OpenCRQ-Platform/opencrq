import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentFlags: Array<string> = [];

// `pmConfig` and `getProcessName` are pulled in by the logger, which the tRPC instance behind
// `featureFlagged` transitively imports.
vi.mock('../../config', () => ({
  config: vi.fn(() => ({ feature_flags: currentFlags })),
  pmConfig: { telemetry: undefined },
  getProcessName: vi.fn(() => 'test'),
}));

const { enabledFeatureFlags, isFeatureEnabled } = await import('./feature-flags');
const { featureFlagged } = await import('./feature-flagged-procedure');
const { trpcInstance } = await import('../../trpc');

// A real router built on the gate, called through tRPC itself: what the gate does to a procedure is the behaviour under test.
const gatedRouter = trpcInstance.router({
  gated: trpcInstance.procedure
    .use(featureFlagged('enterprise-edition-status'))
    .query(() => 'reached the resolver'),
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the gate reads nothing off the request context, so an empty one is enough to reach it.
const callGated = () => trpcInstance.createCallerFactory(gatedRouter)({} as never).gated();

beforeEach(() => {
  currentFlags = [];
});

describe('isFeatureEnabled', () => {
  it('should read a flag as off when nothing is configured', () => {
    expect(isFeatureEnabled('enterprise-edition-status')).toBe(false);
  });

  it('should read a flag as on when it is listed', () => {
    currentFlags = ['enterprise-edition-status'];

    expect(isFeatureEnabled('enterprise-edition-status')).toBe(true);
  });

  it('should read every flag as on behind the wildcard', () => {
    currentFlags = ['*'];

    expect(isFeatureEnabled('enterprise-edition-status')).toBe(true);
  });
});

describe('enabledFeatureFlags', () => {
  it('should publish the enabled flags, and nothing about the registry', () => {
    currentFlags = ['enterprise-edition-status'];

    expect(enabledFeatureFlags()).toEqual(['enterprise-edition-status']);
  });
});

describe('featureFlagged', () => {
  it('should answer FORBIDDEN when the flag is off', async () => {
    await expect(callGated()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Feature enterprise-edition-status is disabled',
    });
  });

  it('should reach the resolver when the flag is on', async () => {
    currentFlags = ['enterprise-edition-status'];

    await expect(callGated()).resolves.toBe('reached the resolver');
  });

  it('should reach the resolver behind the wildcard', async () => {
    currentFlags = ['*'];

    await expect(callGated()).resolves.toBe('reached the resolver');
  });
});
