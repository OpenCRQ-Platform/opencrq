import { vi } from 'vitest';

/**
 * The `connectors` block `config()` serves, keyed by source then by tenant. Empty unless a test
 * writes to it, which is the only way to reach a tenant whose id exists only at run time; a test
 * that writes here owns clearing its own entry.
 */
const testConnectorsConfig: Record<string, Record<string, unknown>> = {};

/**
 * The enabled feature flags `config()` serves. Empty, so a gated surface is off exactly as on a
 * default deployment; a test that turns one on owns clearing its own entry. A test file's own mock
 * of the config cannot turn one on, since this setup has already loaded the flag module through it.
 */
const testFeatureFlags: Array<string> = [];

// Router modules (supporting-assets-router.ts, integrations-router.ts, file-storage-router.ts)
// import `../../../config`, whose module-level parsing breaks when loaded from this package's
// cwd. These tests never boot the real backend process, so a minimal stand-in for `config()` is
// enough. `vi.mock` is hoisted above this file's other imports, so the real module never loads.
vi.mock('../../../back/src/config', () => ({
  config: () => ({ connectors: testConnectorsConfig, feature_flags: testFeatureFlags, recompute: { daily_at: '03:00' } }),
  pmConfig: {},
  getProcessName: () => 'test',
}));

export { testConnectorsConfig, testFeatureFlags };
