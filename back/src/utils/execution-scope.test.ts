import { describe, expect, it } from 'vitest';
import { currentExecutionScope, runInExecutionScope } from './execution-scope';

const scope = (scopeId: string) => ({
  scopeId,
  scopeKind: 'drata-sync',
  tenantId: `tenant-${scopeId}`,
  jobId: scopeId,
  retention: 'on-scope-end' as const,
});

describe('execution scope', () => {
  it('has no scope outside a run', () => {
    expect(currentExecutionScope()).toBeUndefined();
  });

  it('carries the scope across awaits', async () => {
    const seen = await runInExecutionScope(scope('a'), async () => {
      await Promise.resolve();
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      return currentExecutionScope();
    });

    expect(seen?.scopeId).toBe('a');
  });

  it('keeps two concurrent scopes apart', async () => {
    const read = async (id: string) => runInExecutionScope(scope(id), async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, id === 'a' ? 5 : 1);
      });
      return currentExecutionScope()?.tenantId;
    });

    await expect(Promise.all([read('a'), read('b')])).resolves.toEqual(['tenant-a', 'tenant-b']);
  });

  it('leaves no scope behind once the run has ended', async () => {
    await runInExecutionScope(scope('a'), async () => Promise.resolve());

    expect(currentExecutionScope()).toBeUndefined();
  });
});
