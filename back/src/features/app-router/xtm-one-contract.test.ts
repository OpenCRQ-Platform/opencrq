import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initTRPC } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import pin from '../xtm-one/contract/xtm-one-contract.json';
import { describeProcedures } from './procedure-manifest';
import { servedRouter } from './served-router-fixtures';
import { findContractBreaks, parsePinnedProcedures, parseToolInputKeys, parseToolProcedures } from './xtm-one-contract';

// The router's import graph parses the process configuration at load, which a unit test has none of.
vi.mock('../../config', () => ({ pmConfig: {}, getProcessName: () => 'test', config: () => ({}) }));

const CACHE_DIR = fileURLToPath(new URL(`../../../../node_modules/.cache/xtm-one-contract/${pin.commit}/`, import.meta.url));

// The files are read from XTM One's repository at the pinned commit, once per commit.
const contractFile = async (name: string): Promise<unknown> => {
  const source = pin.files.find((file) => basename(file) === name);
  if (!source) {
    throw new Error(`xtm-one-contract.json lists no ${name}`);
  }
  const cached = join(CACHE_DIR, name);
  if (!existsSync(cached)) {
    const url = `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/${source}`;
    // Under the test's own timeout, so that a download stalled before or after the headers still names its URL.
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      .then(async (answer) => ({ ok: answer.ok, status: answer.status, body: await answer.text() }))
      .catch((error: unknown) => {
        throw new Error(`${url} could not be downloaded`, { cause: error });
      });
    if (!response.ok) {
      throw new Error(`${url} answered HTTP ${response.status}`);
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(`${cached}.part`, response.body);
    renameSync(`${cached}.part`, cached);
  }
  return JSON.parse(readFileSync(cached, 'utf8'));
};

const t = initTRPC.create();

const servedBy = (router: Parameters<typeof describeProcedures>[0]) => describeProcedures(router).procedures;

const nodeSchema = z.object({ label: z.string(), get children() {
  return z.array(nodeSchema);
} }).meta({ id: 'Node' });

const routerOf = (inputs: { create: z.ZodType }) => t.router({
  things: t.router({
    create: t.procedure.input(inputs.create).mutation(() => null),
  }),
});

const baseline = z.object({ name: z.string(), note: z.string().optional(), tags: z.array(z.object({ key: z.string() })).optional(), tree: nodeSchema.optional(), meta: z.record(z.string(), z.string()).optional() });

const calls = (call: Partial<{ procedures: Array<string>, fields: Array<string>, conditional: Array<string>, closed: boolean }>) => parseToolInputKeys({
  create_thing: [{ procedures: ['things.create'], fields: ['name'], conditional: [], closed: true, ...call }],
});

const breaksOf = (
  router: Parameters<typeof describeProcedures>[0],
  tools: ReturnType<typeof calls>,
  { procedures = { create_thing: ['things.create'] }, pinned = [{ path: 'things.create', type: 'mutation' }] } = {},
) => (
  findContractBreaks(servedBy(router), parseToolProcedures(procedures), tools, parsePinnedProcedures({ procedures: pinned })).map(({ message }) => message)
);

describe('findContractBreaks', () => {
  it('should pass a router that still serves what the tool sends', () => {
    expect(breaksOf(routerOf({ create: baseline }), calls({ fields: ['name', 'note', 'tags[].key', 'tree.children[].label', 'meta.*'], conditional: ['note'] }))).toEqual([]);
  });

  it('should refuse a renamed procedure, naming the tool and the procedure', () => {
    const renamed = t.router({ things: t.router({ make: t.procedure.input(baseline).mutation(() => null) }) });

    expect(breaksOf(renamed, calls({ procedures: ['things.make'] }))).toEqual([
      expect.stringMatching(/^XTM One tool create_thing: procedure things\.create is no longer served\. Keep the old name/),
    ]);
  });

  it('should refuse a procedure that became a subscription', () => {
    const subscription = t.router({ things: t.router({ create: t.procedure.input(baseline).subscription(() => (async function* generate() {
      yield await Promise.resolve(1);
    }())) }) });

    expect(breaksOf(subscription, calls({}))).toEqual([expect.stringContaining('cannot call with GET or POST')]);
  });

  it('should refuse a field the input no longer knows, at any depth, naming the field', () => {
    const slimmer = z.object({ name: z.string(), tags: z.array(z.object({ other: z.string() })).optional() });

    expect(breaksOf(routerOf({ create: slimmer }), calls({ fields: ['name', 'note', 'tags[].key'] }))).toEqual([
      expect.stringContaining('no longer accepts the field note'),
      expect.stringContaining('no longer accepts the field tags[].key'),
    ]);
  });

  it('should read through chained inputs and unions', () => {
    const router = t.router({ things: t.router({
      create: t.procedure.input(z.object({ name: z.string() })).input(z.union([z.object({ kind: z.literal('a'), a: z.string() }), z.object({ kind: z.literal('b'), b: z.string() })])).mutation(() => null),
    }) });

    expect(breaksOf(router, calls({ fields: ['name', 'kind', 'a', 'b'], closed: false }))).toEqual([]);
    expect(breaksOf(router, calls({ fields: ['name', 'c'], closed: false }))).toEqual([expect.stringContaining('field c')]);
  });

  it('should accept a conditional field one procedure of the call takes, and refuse one none takes', () => {
    const router = t.router({ things: t.router({
      create: t.procedure.input(z.object({ name: z.string() })).mutation(() => null),
      link: t.procedure.input(z.object({ name: z.string(), ownerId: z.string() })).mutation(() => null),
    }) });
    const both = { procedures: ['things.create', 'things.link'], fields: ['name', 'ownerId'], conditional: ['ownerId'], closed: false };
    const bothProcedures = { create_thing: ['things.create', 'things.link'] };
    const bothPinned = [{ path: 'things.create', type: 'mutation' }, { path: 'things.link', type: 'mutation' }];

    expect(breaksOf(router, calls(both), { procedures: bothProcedures, pinned: bothPinned })).toEqual([]);
    expect(breaksOf(router, calls({ ...both, fields: ['name', 'ghost'], conditional: ['ghost'] }), { procedures: bothProcedures, pinned: bothPinned })).toEqual([
      expect.stringContaining('none of things.create, things.link accepts the field ghost'),
    ]);
  });

  it('should refuse a field a closed call never sends once the input requires it', () => {
    const stricter = baseline.extend({ owner: z.string() });

    expect(breaksOf(routerOf({ create: stricter }), calls({}))).toEqual([expect.stringContaining('now requires the field owner')]);
    expect(breaksOf(routerOf({ create: stricter }), calls({ closed: false }))).toEqual([]);
  });

  it('should refuse a conditional field of a closed single-procedure call once the input requires it', () => {
    const searching = z.object({ name: z.string(), search: z.string() });

    expect(breaksOf(routerOf({ create: searching }), calls({ fields: ['name', 'search'], conditional: ['search'] }))).toEqual([
      expect.stringContaining('now requires the field search'),
    ]);
    expect(breaksOf(routerOf({ create: searching }), calls({ fields: ['name', 'search'] }))).toEqual([]);
  });

  it('should refuse a conditional field of a closed call to several procedures once one of them requires it', () => {
    const router = t.router({ things: t.router({
      create: t.procedure.input(z.object({ title: z.string() })).mutation(() => null),
      link: t.procedure.input(z.object({ title: z.string(), name: z.string() })).mutation(() => null),
    }) });
    const options = {
      procedures: { create_thing: ['things.create', 'things.link'] },
      pinned: [{ path: 'things.create', type: 'mutation' }, { path: 'things.link', type: 'mutation' }],
    };

    expect(breaksOf(router, calls({ procedures: ['things.create', 'things.link'], fields: ['title', 'name'], conditional: ['name'] }), options)).toEqual([
      expect.stringContaining('things.link now requires the field name'),
    ]);
  });

  it('should refuse a field a closed call never sends when the input is nullable', () => {
    const nullable = z.object({ name: z.string(), owner: z.string() }).nullable();

    expect(breaksOf(routerOf({ create: nullable }), calls({}))).toEqual([expect.stringContaining('now requires the field owner')]);
  });

  it('should pass a field under an array widened to an unconstrained value', () => {
    const widened = baseline.extend({ tags: z.unknown() });

    expect(breaksOf(routerOf({ create: widened }), calls({ fields: ['name', 'tags[].key'] }))).toEqual([]);
  });

  it('should pass a field under a property left unconstrained', () => {
    const widened = baseline.extend({ tags: z.unknown() });

    expect(breaksOf(routerOf({ create: widened }), calls({ fields: ['name', 'tags.key'] }))).toEqual([]);
  });

  it('should refuse a field under a property that is not an object', () => {
    expect(breaksOf(routerOf({ create: baseline }), calls({ fields: ['name', 'name.first'] }))).toEqual([
      expect.stringContaining('no longer accepts the field name.first'),
    ]);
  });

  it('should refuse a field under a property that cannot be an object even when an alternative stays open', () => {
    const contradictory = baseline.extend({ name: z.string().and(z.looseObject({})) });

    expect(breaksOf(routerOf({ create: contradictory }), calls({ fields: ['name.first'] }))).toEqual([
      expect.stringContaining('no longer accepts the field name.first'),
    ]);
  });

  it('should refuse an element field under a property that is not an array', () => {
    expect(breaksOf(routerOf({ create: baseline.extend({ tags: z.string() }) }), calls({ fields: ['name', 'tags[].key'] }))).toEqual([
      expect.stringContaining('no longer accepts the field tags[].key'),
    ]);
  });

  it('should pass an added procedure and an added optional field', () => {
    const wider = baseline.extend({ extra: z.string().optional() });
    const router = t.router({ things: t.router({
      create: t.procedure.input(wider).mutation(() => null),
      archive: t.procedure.input(z.object({ id: z.string() })).mutation(() => null),
    }) });

    expect(breaksOf(router, calls({}))).toEqual([]);
  });

  it('should refuse a procedure turned from a query into a mutation, naming the tool', () => {
    expect(breaksOf(routerOf({ create: baseline }), calls({}), { pinned: [{ path: 'things.create', type: 'query' }] })).toEqual([
      expect.stringMatching(/^XTM One tool create_thing: procedure things\.create is now a mutation, while XTM One sends it as a query\. Keep the old name/),
    ]);
  });

  it('should not hold a procedure XTM One never pinned to a type', () => {
    expect(breaksOf(routerOf({ create: baseline }), calls({}), { pinned: [] })).toEqual([]);
  });

  it('should treat a procedure without input as accepting no field', () => {
    const router = t.router({ things: t.router({ create: t.procedure.mutation(() => null) }) });

    expect(breaksOf(router, calls({ fields: [] }))).toEqual([]);
    expect(breaksOf(router, calls({ fields: ['name'] }))).toEqual([expect.stringContaining('field name')]);
  });
});

describe('the XTM One tools against the served router', () => {
  it('should send only procedures, types, fields and required inputs the router still serves', { timeout: 30_000 }, async () => {
    const [toolProcedures, toolInputKeys, pinnedProcedures] = await Promise.all(['tool_procedures.json', 'tool_input_keys.json', 'opencrq_trpc_procedures.json'].map(contractFile));
    const served = describeProcedures(servedRouter()).procedures;

    const breaks = findContractBreaks(served, parseToolProcedures(toolProcedures), parseToolInputKeys(toolInputKeys), parsePinnedProcedures(pinnedProcedures));

    expect(breaks.map(({ message }) => message)).toEqual([]);
  });
});
