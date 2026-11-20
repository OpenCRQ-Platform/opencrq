import { describe, expect, it } from 'vitest';
import { onCompleteMirrors } from './openaev-reconciliation-scope';

describe('onCompleteMirrors', () => {
  const registry = new Map([['a-1', 'sa-1'], ['a-2', 'sa-1'], ['b-1', 'sa-2'], ['a-3', 'sa-3']]);
  const tenantOfAsset = new Map([['a-1', 'tenant-a'], ['a-2', 'tenant-a'], ['b-1', 'tenant-b'], ['a-3', 'tenant-a']]);
  const runTenantIds = ['tenant-a', 'tenant-b'];

  it('passes an asset whose OpenAEV assets all belong to a tenant with a complete mirror', () => {
    const judgeable = onCompleteMirrors({ registry, tenantOfAsset, completeTenants: new Set(['tenant-a']), runTenantIds });

    expect(['sa-1', 'sa-3'].filter(judgeable)).toEqual(['sa-1', 'sa-3']);
  });

  it('refuses an asset held by a tenant whose mirror is not complete', () => {
    const judgeable = onCompleteMirrors({ registry, tenantOfAsset, completeTenants: new Set(['tenant-a']), runTenantIds });

    expect(['sa-1', 'sa-2'].filter(judgeable)).toEqual(['sa-1']);
  });

  it('refuses an asset one of whose OpenAEV assets belongs to a tenant whose mirror is not complete', () => {
    const folded = new Map([...registry, ['b-2', 'sa-1']]);
    const tenants = new Map([...tenantOfAsset, ['b-2', 'tenant-b']]);

    expect(onCompleteMirrors({ registry: folded, tenantOfAsset: tenants, completeTenants: new Set(['tenant-a']), runTenantIds })('sa-1')).toBe(false);
  });

  it('passes an asset with an OpenAEV asset of unknown tenant only when every tenant of the run is complete', () => {
    const input = { registry: new Map([...registry, ['unknown', 'sa-1']]), tenantOfAsset, runTenantIds };

    expect(onCompleteMirrors({ ...input, completeTenants: new Set(['tenant-a']) })('sa-1')).toBe(false);
    expect(onCompleteMirrors({ ...input, completeTenants: new Set(['tenant-a', 'tenant-b']) })('sa-1')).toBe(true);
  });

  it('passes every asset when the registry knows no tenant at all and every tenant of the run is complete, and none when one is not', () => {
    const input = { registry, tenantOfAsset: new Map<string, string>(), runTenantIds };

    expect(['sa-1', 'sa-2'].filter(onCompleteMirrors({ ...input, completeTenants: new Set(['tenant-a']) }))).toEqual([]);
    expect(['sa-1', 'sa-2'].filter(onCompleteMirrors({ ...input, completeTenants: new Set(runTenantIds) }))).toEqual(['sa-1', 'sa-2']);
  });

  it('passes an asset no OpenAEV asset maps to', () => {
    expect(onCompleteMirrors({ registry, tenantOfAsset, completeTenants: new Set(), runTenantIds })('sa-unknown')).toBe(true);
  });
});
