import { AsyncLocalStorage } from 'node:async_hooks';

/** The unit of work a log line belongs to. `jobId` is null for a stream session, which has no job. */
export interface ExecutionScope {
  scopeId: string,
  scopeKind: string,
  tenantId: string,
  jobId: string | null,
  /**
   * Where the store cuts this scope's lines: `on-scope-end` keeps them all until the scope closes,
   * while `rolling` is trimmed to a line count on every write and stays bounded however long the
   * scope lives.
   */
  retention: 'on-scope-end' | 'rolling',
}

const storage = new AsyncLocalStorage<ExecutionScope>();

export const runInExecutionScope = <T>(scope: ExecutionScope, fn: () => Promise<T>): Promise<T> =>
  storage.run(scope, fn);

export const currentExecutionScope = (): ExecutionScope | undefined => storage.getStore();
