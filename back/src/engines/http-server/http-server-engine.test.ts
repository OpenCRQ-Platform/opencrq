import { describe, expect, it, vi } from 'vitest';
import { listEngines } from '../engines-manager';
import './http-server-engine'; // side-effect: registers the http-server engine

// vi.mock is hoisted by vitest before any import is resolved, so the mock is
// active when http-server-engine loads and calls config().
vi.mock('../../config', () => ({
  config: vi.fn(() => ({ http_server: undefined })),
  pmConfig: { inDev: false },
  getProcessName: vi.fn(() => 'test'),
}));

// Prevent db-engine from running buildPgConnectionConfig() at module load —
// this test is not concerned with the DB layer.
vi.mock('../db', () => ({
  dbEngine: { db: {}, checkConnection: vi.fn(() => true) },
}));

describe('http-server-engine', () => {
  it('returns a no-op handler when http_server config is absent', async () => {
    const engine = listEngines().find(({ key }) => key === 'http-server');
    expect(engine).toBeDefined();

    const handler = await engine!.start(new AbortController().signal);

    expect(handler).toEqual({});
  });
});
