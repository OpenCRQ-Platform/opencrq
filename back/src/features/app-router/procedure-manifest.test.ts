import { initTRPC } from '@trpc/server';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import type { TRPCRouter } from '../../types/trpc-router';
import { canonicalJson, createServedProcedureManifest, describeProcedures, procedureManifestFingerprint } from './procedure-manifest';
import { servedRouter } from './served-router-fixtures';

// The router's import graph parses the process configuration at load, which a unit test has none of.
vi.mock('../../config', () => ({ pmConfig: {}, getProcessName: () => 'test', config: () => ({}) }));

describe('describeProcedures', () => {
  const t = initTRPC.create();
  const node = z.object({ name: z.string(), get children() {
    return z.array(node);
  } }).meta({ id: 'TreeNode' });
  const { procedures } = describeProcedures(t.router({
    tenants: t.router({
      updateTenant: t.procedure.input(z.object({ name: z.string() })).mutation(() => null),
      getTenants: t.procedure.query(() => []),
    }),
    jobs: t.router({
      listRuns: t.procedure.input(z.object({ from: z.coerce.date() })).query(() => []),
    }),
    trees: t.router({
      saveTree: t.procedure.input(z.object({ tenantId: z.uuid() })).input(z.object({ root: node })).mutation(() => null),
    }),
  }));
  const inputOf = (path: string) => procedures.find((procedure) => procedure.path === path)?.input;

  it('should list every procedure by its full path, sorted', () => {
    expect(procedures.map(({ path }) => path)).toEqual(['jobs.listRuns', 'tenants.getTenants', 'tenants.updateTenant', 'trees.saveTree']);
  });

  it('should tell a query from a mutation', () => {
    expect(procedures.map(({ type }) => type)).toEqual(['query', 'query', 'mutation', 'mutation']);
  });

  it('should describe a procedure without input as taking none', () => {
    expect(inputOf('tenants.getTenants')).toBeNull();
  });

  it('should describe a date input as the ISO string the JSON wire carries', () => {
    expect(inputOf('jobs.listRuns')).toMatchObject({ properties: { from: { type: 'string', format: 'date-time' } } });
  });

  it('should not require a field that has a default, since a call may leave it out', () => {
    const t2 = initTRPC.create();
    const [{ input }] = describeProcedures(t2.router({
      runs: t2.router({ listRuns: t2.procedure.input(z.object({ tenantId: z.uuid(), sort: z.enum(['asc', 'desc']).default('asc') })).query(() => []) }),
    })).procedures;

    expect(input).toMatchObject({ required: ['tenantId'], properties: { sort: { default: 'asc' } } });
  });

  it('should leave the JSON Schema dialect out of each input', () => {
    expect(inputOf('tenants.updateTenant')).not.toHaveProperty('$schema');
  });

  it('should merge chained inputs into one schema whose references resolve from its root', () => {
    const input = inputOf('trees.saveTree');

    expect(input).toHaveProperty(['$defs', 'TreeNode']);
    expect(JSON.stringify(input)).toContain('"$ref":"#/$defs/TreeNode"');
  });

  it.each([
    ['custom', z.custom<string>((value) => typeof value === 'string')],
    ['instanceof', z.instanceof(URL)],
    ['bigint', z.bigint()],
  ])('should refuse a %s input, which JSON cannot carry, naming its procedure', (_, input) => {
    const t2 = initTRPC.create();

    expect(() => describeProcedures(t2.router({ uploads: t2.router({ upload: t2.procedure.input(z.object({ value: input })).mutation(() => null) }) })))
      .toThrow(/^uploads\.upload: /);
  });
});

describe('canonicalJson', () => {
  it('should sort object keys at every depth and keep array order', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }, 'x'], a: null })).toBe('{"a":null,"b":[{"a":2,"z":1},"x"]}');
  });

  it('should leave out an undefined member, as JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('procedureManifestFingerprint', () => {
  const t = initTRPC.create();
  const describeWith = (input: z.ZodType) => describeProcedures(t.router({
    tenants: t.router({ updateTenant: t.procedure.input(input).mutation(() => null) }),
  }));
  const manifest = describeWith(z.object({ name: z.string(), color: z.string() }));

  it('should be 64 hexadecimal characters, the same on every call', () => {
    expect(procedureManifestFingerprint(manifest)).toMatch(/^[0-9a-f]{64}$/);
    expect(procedureManifestFingerprint(manifest)).toBe(procedureManifestFingerprint(describeWith(z.object({ name: z.string(), color: z.string() }))));
  });

  it('should not depend on the order the keys were written in', () => {
    const [procedure] = manifest.procedures;
    const reversed = {
      procedures: [{ input: procedure.input, type: procedure.type, path: procedure.path }],
      jsonSchemaDialect: manifest.jsonSchemaDialect,
      formatVersion: manifest.formatVersion,
    };

    expect(procedureManifestFingerprint(reversed)).toBe(procedureManifestFingerprint(manifest));
  });

  it('should change when an input field is added', () => {
    expect(procedureManifestFingerprint(describeWith(z.object({ name: z.string(), color: z.string(), size: z.number() }))))
      .not.toBe(procedureManifestFingerprint(manifest));
  });

  it('should change when a field becomes optional', () => {
    expect(procedureManifestFingerprint(describeWith(z.object({ name: z.string(), color: z.string().optional() }))))
      .not.toBe(procedureManifestFingerprint(manifest));
  });

  it('should change when a procedure is added', () => {
    const wider = describeProcedures(t.router({
      tenants: t.router({
        updateTenant: t.procedure.input(z.object({ name: z.string(), color: z.string() })).mutation(() => null),
        getTenants: t.procedure.query(() => []),
      }),
    }));

    expect(procedureManifestFingerprint(wider)).not.toBe(procedureManifestFingerprint(manifest));
  });
});

describe('createServedProcedureManifest', () => {
  const t = initTRPC.create();
  const routerWith = (input: z.ZodType) => t.router({ things: t.router({ save: t.procedure.input(input).mutation(() => null) }) });

  it('should be null until a router is published', () => {
    expect(createServedProcedureManifest(() => null)()).toBeNull();
  });

  it('should describe the published router, with its fingerprint', () => {
    const router = routerWith(z.object({ name: z.string() }));

    const served = createServedProcedureManifest(() => router)();

    expect(served).toEqual({ ...describeProcedures(router), fingerprint: procedureManifestFingerprint(describeProcedures(router)) });
  });

  it('should describe a router once, however often it is read', () => {
    const router = routerWith(z.object({ name: z.string() }));
    const served = createServedProcedureManifest(() => router);

    expect(served()).toBe(served());
  });

  it('should follow the router when another is published', () => {
    let router: ReturnType<typeof routerWith> | null = null;
    const served = createServedProcedureManifest(() => router);
    expect(served()).toBeNull();

    router = routerWith(z.object({ name: z.string() }));
    const first = served();
    router = routerWith(z.object({ name: z.string(), size: z.number() }));

    expect(first).not.toBeNull();
    expect(served()?.fingerprint).not.toBe(first?.fingerprint);
  });
});

describe('the committed tRPC procedure manifest', () => {
  it('should describe every root router clients call', () => {
    expectTypeOf<keyof ReturnType<typeof servedRouter>['_def']['record']>().toEqualTypeOf<keyof TRPCRouter['_def']['record']>();
  });

  it('should match what /trpc serves, so a renamed or removed procedure shows in the pull request that does it', async () => {
    const manifest = describeProcedures(servedRouter());

    await expect(`${JSON.stringify(manifest, null, 2)}\n`).toMatchFileSnapshot('../../../trpc-procedures.json');
  });
});
