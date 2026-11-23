import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';

const mockApplyDependencyRules = vi.fn().mockResolvedValue({ rules: 0, inserted: 0, updated: 0, deleted: 0 });
const mockWithOrigin = vi.fn().mockReturnValue({
  assetDependencies: { applyDependencyRules: mockApplyDependencyRules },
});
const mockCreateServices = vi.fn().mockReturnValue({ withOrigin: mockWithOrigin });

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: mockCreateServices,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn() }),
}));

const { dependencyRulesApplyHandler } = await import('./dependency-rules-apply-handler');

const runDb = { run: true };

const makeCtx = (overrides: Partial<JobContext> = {}): JobContext => ({
  jobId: 'job-rules-1',
  tenantId: 'tenant-abc',
  kind: 'dependency-rules-apply',
  interactive: false,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the services factory is mocked, so the run's instance is only passed through
  runDb: runDb as never,
  ...overrides,
});

describe('dependencyRulesApplyHandler', () => {
  beforeEach(() => {
    mockApplyDependencyRules.mockClear();
    mockWithOrigin.mockClear();
    mockCreateServices.mockClear();
  });

  it('refuses to run unobserved', async () => {
    await expect(dependencyRulesApplyHandler(makeCtx({ runDb: undefined }))).rejects.toThrow('dependency rules apply must run as an observed job');
    expect(mockApplyDependencyRules).not.toHaveBeenCalled();
  });

  it('builds its services on the run instance, never the shared one', async () => {
    await dependencyRulesApplyHandler(makeCtx());

    expect(mockCreateServices).toHaveBeenCalledWith([], runDb);
  });

  it('runs under the job of the tenant it was booked for', async () => {
    await dependencyRulesApplyHandler(makeCtx({ interactive: true }));

    expect(mockWithOrigin).toHaveBeenCalledWith({ type: 'job', tenantId: 'tenant-abc', jobKind: 'dependency-rules-apply', interactive: true });
  });

  it('applies the rules once per run', async () => {
    await dependencyRulesApplyHandler(makeCtx());

    expect(mockApplyDependencyRules).toHaveBeenCalledOnce();
  });

  it('does nothing once aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await dependencyRulesApplyHandler(makeCtx({ signal: controller.signal }));

    expect(mockCreateServices).not.toHaveBeenCalled();
    expect(mockApplyDependencyRules).not.toHaveBeenCalled();
  });
});
