import { RuleTester } from 'eslint';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import typescriptEslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import {
  collapseWrappedMemberAccess,
  collectTsContent,
  extractFactoryToMountKey,
  extractLocalMounts,
  getFactoryToMountKey,
  makeRouterEndpointChecker,
  makeUnusedMethodRule,
  mountPathForFactory,
  routerEndpointPattern,
  stripComments,
} from './no-unused-endpoint';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

// Build a minimal rule using makeUnusedMethodRule with injected content,
// bypassing any real filesystem I/O.
const makeTestRule = ({
  content,
  selector,
  isUsed = (name: string, c: string) => c.includes(`.${name}(`),
}: {
  content: string,
  selector: string,
  isUsed?: (name: string, content: string) => boolean,
}) =>
  makeUnusedMethodRule({
    description: 'test rule',
    unusedMessage: "Unused '{{methodName}}'.",
    selector,
    makeChecker: () => ({
      isUsed: (methodName) => isUsed(methodName, content),
      msgData: (methodName) => ({ methodName }),
    }),
  });

// ─── stripComments ────────────────────────────────────────────────────────────

describe('stripComments', () => {
  it('removes block comments', () => {
    expect(stripComments('a /* comment */ b')).toBe('a   b');
  });

  it('removes line comments', () => {
    expect(stripComments('const x = 1; // inline\nconst y = 2;')).toBe('const x = 1;  \nconst y = 2;');
  });

  it('removes multiline block comments', () => {
    expect(stripComments('a\n/* line1\nline2\n*/\nb')).toBe('a\n \nb');
  });

  it('preserves normal code untouched', () => {
    expect(stripComments('repo.findById(id)')).toBe('repo.findById(id)');
  });

  it('preserves method call patterns that contain slashes (e.g. division)', () => {
    expect(stripComments('const r = a / b;')).toBe('const r = a / b;');
  });
});

// ─── collapseWrappedMemberAccess ──────────────────────────────────────────────

describe('collapseWrappedMemberAccess', () => {
  it('joins a method chain that prettier wrapped onto the next line', () => {
    expect(collapseWrappedMemberAccess('trpc.attackOutcomes\n    .getCuratedMitreTechniquesForOutcome.queryOptions({ id })'))
      .toBe('trpc.attackOutcomes.getCuratedMitreTechniquesForOutcome.queryOptions({ id })');
  });

  it('leaves a chain already on one line untouched', () => {
    expect(collapseWrappedMemberAccess('trpc.jobs.listRuns.queryOptions(params)')).toBe('trpc.jobs.listRuns.queryOptions(params)');
  });

  // Without this wiring the whole mount-key qualification silently stops
  // matching the three call sites prettier wrapped in front/src.
  it('is applied by collectTsContent, so a wrapped call site reads as qualified', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-ts-content-'));
    fs.writeFileSync(
      path.join(dir, 'panel.tsx'),
      'const { data } = trpc.jobs\n    .listRuns.queryOptions(params);\n',
    );
    expect(collectTsContent(dir)).toContain('.jobs.listRuns.queryOptions(');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ─── noUnusedRepoMethod (via makeUnusedMethodRule) ───────────────────────────

describe('noUnusedRepoMethod', () => {
  const selector = 'CallExpression[callee.name="defineRepository"] > ObjectExpression';

  it('reports a method absent from the content', () => {
    ruleTester.run('no-unused-repo-method', makeTestRule({ content: '', selector }), {
      valid: [],
      invalid: [
        {
          code: 'defineRepository({ findAll() {} })',
          errors: [{ messageId: 'unused' }],
        },
      ],
    });
  });

  it('does not report a method present as .method( in the content', () => {
    ruleTester.run('no-unused-repo-method', makeTestRule({ content: 'repo.findAll()', selector }), {
      valid: [{ code: 'defineRepository({ findAll() {} })' }],
      invalid: [],
    });
  });

  it('reports only the unused methods when some are used and some are not', () => {
    ruleTester.run('no-unused-repo-method', makeTestRule({ content: 'repo.usedMethod()', selector }), {
      valid: [],
      invalid: [
        {
          code: 'defineRepository({ usedMethod() {}, unusedMethod() {} })',
          errors: [{ messageId: 'unused' }],
        },
      ],
    });
  });

  it('does not count the method as used when it appears only in a comment of the source', () => {
    // collectTsContent applies stripComments before storing content.
    // Simulating that pipeline: pre-strip a source where the method appears only in a comment.
    const strippedContent = stripComments('// repo.findAll() — mentioned in a comment only');
    ruleTester.run('no-unused-repo-method', makeTestRule({ content: strippedContent, selector }), {
      valid: [],
      invalid: [
        {
          code: 'defineRepository({ findAll() {} })',
          errors: [{ messageId: 'unused' }],
        },
      ],
    });
  });
});

// ─── noUnusedServiceMethod — selector fix (:has guard) ───────────────────────

describe('noUnusedServiceMethod selector fix', () => {
  const selector =
    'CallExpression[callee.property.name="implement"]:has(CallExpression[callee.name="defineService"]) > ObjectExpression';

  // Empty content → any matched method will be reported.
  const ruleNoContent = makeTestRule({ content: '', selector });

  it('reports an unused method in a defineService().implement() chain', () => {
    ruleTester.run('no-unused-service-method', ruleNoContent, {
      valid: [],
      invalid: [
        {
          code: 'defineService({}).implement({ myMethod() {} })',
          errors: [{ messageId: 'unused' }],
        },
      ],
    });
  });

  it('reports an unused method in a defineService().dependsOn().implement() chain', () => {
    ruleTester.run('no-unused-service-method', ruleNoContent, {
      valid: [],
      invalid: [
        {
          code: 'defineService({}).dependsOn({}).implement({ myMethod() {} })',
          errors: [{ messageId: 'unused' }],
        },
      ],
    });
  });

  it('does NOT report when .implement() is not part of a defineService() chain', () => {
    // This is the key behavior verified by the :has() fix.
    ruleTester.run('no-unused-service-method', ruleNoContent, {
      valid: [
        { code: 'someOtherLib.implement({ myMethod() {} })' },
        { code: 'container.implement({ myMethod() {} })' },
      ],
      invalid: [],
    });
  });

  it('does not report a method that appears as .method( in the content', () => {
    ruleTester.run(
      'no-unused-service-method',
      makeTestRule({ content: 'service.myMethod(args)', selector }),
      {
        valid: [{ code: 'defineService({}).implement({ myMethod() {} })' }],
        invalid: [],
      },
    );
  });
});

// ─── noUnusedRouterEndpoint ──────────────────────────────────────────────────

describe('noUnusedRouterEndpoint', () => {
  const selector = 'CallExpression[callee.name="router"] > ObjectExpression';

  const makeRouterRule = (content: string) =>
    makeTestRule({
      content,
      selector,
      isUsed: (name, c) => c.includes(`.${name}(`) || c.includes(`.${name}.`),
    });

  it('reports an endpoint absent from the frontend content', () => {
    ruleTester.run('no-unused-router-endpoint', makeRouterRule(''), {
      valid: [],
      invalid: [
        {
          code: 'router({ list() {} })',
          errors: [{ messageId: 'unused' }],
        },
      ],
    });
  });

  it('does not report an endpoint referenced as .method( (direct call)', () => {
    ruleTester.run('no-unused-router-endpoint', makeRouterRule('trpc.list(params)'), {
      valid: [{ code: 'router({ list() {} })' }],
      invalid: [],
    });
  });

  it('does not report an endpoint referenced as .method. (tRPC hook chain)', () => {
    ruleTester.run('no-unused-router-endpoint', makeRouterRule('trpc.list.useQuery(params)'), {
      valid: [{ code: 'router({ list() {} })' }],
      invalid: [],
    });
  });

  it('does not match on a name prefix — "list" should not satisfy ".listAll."', () => {
    // ".listAll.useQuery()" contains ".list" but NOT ".list." — so "list" must be reported.
    ruleTester.run('no-unused-router-endpoint', makeRouterRule('trpc.listAll.useQuery()'), {
      valid: [],
      invalid: [
        {
          code: 'router({ list() {} })',
          errors: [{ messageId: 'unused' }],
        },
      ],
    });
  });
});

// ─── noUnusedRouterEndpoint — qualified by client path ───────────────────────
//
// A bare `.<name>(` / `.<name>.` search can't tell which router a procedure
// belongs to, so a same-named procedure on an unrelated router (e.g.
// connectors.listRuns) satisfies the check for a router that has no caller at
// all (e.g. jobs.listRuns). makeRouterEndpointChecker qualifies the search by
// where the `router({...})` object being linted sits in the client's procedure
// tree: its factory's mount key in app-router-router.ts, the mount key a
// wrapper in its own file gives it, then the keys of the `router({...})`
// objects it is nested in.

describe('extractFactoryToMountKey', () => {
  it('maps each factory name to its mount key', () => {
    const aggregator = `
      import { jobsRouter } from './jobs';
      return router({
        health: publicProcedure.query(() => ({ status: 'ok' })),
        jobs: jobsRouter(authProcedure),
        connectors: connectorsRouter(authProcedure, telemetry),
      });
    `;
    const map = extractFactoryToMountKey(aggregator);
    expect([...map]).toEqual([['jobsRouter', 'jobs'], ['connectorsRouter', 'connectors']]);
  });
});

describe('extractLocalMounts', () => {
  it('records the wrapper that mounts another factory of the same file', () => {
    const source = [
      'export const xtmOneRouter = (protectedProcedure, db) => router({',
      '  getSettings: protectedProcedure.query(() => ({})),',
      '});',
      'export const xtmOneRootRouter = (protectedProcedure, db) => router({',
      '  xtmOne: xtmOneRouter(protectedProcedure, db),',
      '});',
    ].join('\n');
    expect([...extractLocalMounts(source)]).toEqual([
      ['xtmOneRouter', { mountKey: 'xtmOne', owner: 'xtmOneRootRouter' }],
    ]);
  });

  it('keeps the exported factory as owner across a local binding in its body', () => {
    const source = [
      'export const fooRouter = (p) => {',
      '  const services = createServices(p);',
      '  return router({ bar: barRouter(p) });',
      '};',
    ].join('\n');
    expect([...extractLocalMounts(source)]).toEqual([
      ['barRouter', { mountKey: 'bar', owner: 'fooRouter' }],
    ]);
  });

  it('does not read an inline nested router as a mounted factory', () => {
    const source = 'export const eventsRouter = (p) => router({ events: router({ onDataChanged: p.subscription() }) });';
    expect([...extractLocalMounts(source)]).toEqual([]);
  });
});

describe('mountPathForFactory', () => {
  const aggregator = new Map([['jobsRouter', 'jobs'], ['connectorsRouter', 'connectors']]);

  it('is the aggregator mount key for a factory the aggregator mounts', () => {
    expect(mountPathForFactory('jobsRouter', aggregator, new Map())).toEqual(['jobs']);
  });

  it('is empty for a factory nothing mounts — registerRouter merges it at the root', () => {
    expect(mountPathForFactory('eventsRouter', aggregator, new Map())).toEqual([]);
  });

  it('is the local mount key under the wrapper, when the wrapper itself is merged at the root', () => {
    const localMounts = new Map([['xtmOneRouter', { mountKey: 'xtmOne', owner: 'xtmOneRootRouter' }]]);
    expect(mountPathForFactory('xtmOneRouter', aggregator, localMounts)).toEqual(['xtmOne']);
  });

  it('composes a local mount with the path of the wrapper that holds it', () => {
    const localMounts = new Map([['barRouter', { mountKey: 'bar', owner: 'jobsRouter' }]]);
    expect(mountPathForFactory('barRouter', aggregator, localMounts)).toEqual(['jobs', 'bar']);
  });

  it('stops rather than loop when two factories mount each other', () => {
    const localMounts = new Map([
      ['aRouter', { mountKey: 'a', owner: 'bRouter' }],
      ['bRouter', { mountKey: 'b', owner: 'aRouter' }],
    ]);
    expect(mountPathForFactory('aRouter', new Map(), localMounts)).toEqual(['b', 'a']);
  });
});

describe('routerEndpointPattern', () => {
  it('qualifies by the mount key when there is one', () => {
    expect(routerEndpointPattern('listRuns', ['jobs'])).toBe('.jobs.listRuns');
  });

  it('qualifies by the whole path of a nested router', () => {
    expect(routerEndpointPattern('onDataChanged', ['jobs', 'events'])).toBe('.jobs.events.onDataChanged');
  });

  it('falls back to the router-blind pattern for a router merged at the root', () => {
    expect(routerEndpointPattern('listRuns', [])).toBe('.listRuns');
  });
});

// The rule resolves the aggregator's shape by regex, so nothing in the unit
// tests above would notice `app-router-router.ts` moving or mounting its routers
// some other way: the map would just come back short and those routers would
// silently revert to the unqualified search.
describe('the real app-router-router.ts', () => {
  const backSrc = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'back', 'src');

  it('resolves a known mount pair', () => {
    expect(getFactoryToMountKey().get('jobsRouter')).toBe('jobs');
  });

  it('gives the real jobs-router.ts the .jobs path', () => {
    const source = fs.readFileSync(path.join(backSrc, 'features', 'app-router', 'jobs', 'jobs-router.ts'), 'utf-8');
    expect(mountPathForFactory('jobsRouter', getFactoryToMountKey(), extractLocalMounts(source))).toEqual(['jobs']);
  });
});

describe('noUnusedRouterEndpoint — client-path qualification', () => {
  const selector = 'CallExpression[callee.name="router"] > ObjectExpression';

  const makeQualifiedRouterRule = ({
    content,
    factoryMounts = [],
  }: {
    content: string,
    factoryMounts?: Array<[string, string]>,
  }) =>
    makeUnusedMethodRule({
      description: 'test rule',
      unusedMessage: "Unused '{{methodName}}' — searched {{pattern}} in {{frontSrc}}.",
      selector,
      makeChecker: makeRouterEndpointChecker({
        getContent: () => content,
        getFactoryMounts: () => new Map(factoryMounts),
        frontSrc: () => '/front/src',
      }),
    });

  const jobsRouterCode = (body: string) => `export const jobsRouter = (procedure) => router({ ${body} });`;

  it("a jobs.listRuns procedure is no longer 'used' by connectors.listRuns.queryOptions( in the front", () => {
    const rule = makeQualifiedRouterRule({
      content: 'trpc.connectors.listRuns.queryOptions(params)',
      factoryMounts: [['jobsRouter', 'jobs']],
    });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [],
      invalid: [
        {
          code: jobsRouterCode('listRuns() {}'),
          filename: 'jobs-router.ts',
          errors: [{ message: "Unused 'listRuns' — searched .jobs.listRuns in /front/src." }],
        },
      ],
    });
  });

  it('a jobs.listRuns procedure is used by jobs.listRuns.queryOptions( in the front', () => {
    const rule = makeQualifiedRouterRule({
      content: 'trpc.jobs.listRuns.queryOptions(params)',
      factoryMounts: [['jobsRouter', 'jobs']],
    });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [{ code: jobsRouterCode('listRuns() {}'), filename: 'jobs-router.ts' }],
      invalid: [],
    });
  });

  it('a jobs.listRuns procedure is used by a jobs.listRuns.useQuery( hook chain in the front', () => {
    const rule = makeQualifiedRouterRule({
      content: 'trpc.jobs.listRuns.useQuery(params)',
      factoryMounts: [['jobsRouter', 'jobs']],
    });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [{ code: jobsRouterCode('listRuns() {}'), filename: 'jobs-router.ts' }],
      invalid: [],
    });
  });

  // A nested router used to inherit the parent's key whole, so `deepProc` was
  // searched as `.jobs.deepProc` and reported although the front calls it.
  it('a router nested behind a mounted factory is searched under the nested key too', () => {
    const rule = makeQualifiedRouterRule({
      content: 'trpc.jobs.nested.deepProc.queryOptions(params)',
      factoryMounts: [['jobsRouter', 'jobs']],
    });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [{ code: jobsRouterCode('nested: router({ deepProc() {} })'), filename: 'jobs-router.ts' }],
      invalid: [],
    });
  });

  it('reports a nested procedure under its whole path, not the parent key', () => {
    const rule = makeQualifiedRouterRule({
      content: 'trpc.jobs.nested.queryOptions(params)',
      factoryMounts: [['jobsRouter', 'jobs']],
    });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [],
      invalid: [
        {
          code: jobsRouterCode('nested: router({ deepProc() {} })'),
          filename: 'jobs-router.ts',
          errors: [{ message: "Unused 'deepProc' — searched .jobs.nested.deepProc in /front/src." }],
        },
      ],
    });
  });

  // registerRouter hands the router to mergeRouters, which folds it into the
  // root: its own keys are the client's root keys.
  it('searches a root-merged router under its own keys', () => {
    const rule = makeQualifiedRouterRule({ content: 'trpc.login.mutationOptions()' });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [{ code: 'export const authServiceRouter = (p) => router({ login() {} });', filename: 'auth-service-router.ts' }],
      invalid: [],
    });
  });

  it('qualifies the nested router of a root-merged router (events.onDataChanged)', () => {
    const rule = makeQualifiedRouterRule({ content: 'trpc.events.onDataChanged.subscriptionOptions(input)' });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [
        {
          code: 'export const eventsRouter = (p) => router({ events: router({ onDataChanged() {} }) });',
          filename: 'events-router.ts',
        },
      ],
      invalid: [],
    });
  });

  // xtmOneRouter is not mounted by the aggregator: the wrapper registered at the
  // root is what names it, in the linted file itself.
  it('qualifies a factory mounted by a wrapper declared in the same file', () => {
    const code = [
      'export const xtmOneRouter = (p, db) => router({ getSettings() {} });',
      'export const xtmOneRootRouter = (p, db) => router({ xtmOne: xtmOneRouter(p, db) });',
    ].join('\n');
    ruleTester.run('no-unused-router-endpoint', makeQualifiedRouterRule({
      content: 'trpc.xtmOne.getSettings.queryOptions(undefined)',
    }), {
      valid: [{ code, filename: 'xtm-one-router.ts' }],
      invalid: [],
    });
    ruleTester.run('no-unused-router-endpoint', makeQualifiedRouterRule({
      content: 'trpc.connectors.getSettings.queryOptions(undefined) trpc.xtmOne.other.queryOptions()',
    }), {
      valid: [],
      invalid: [
        {
          code,
          filename: 'xtm-one-router.ts',
          errors: [{ message: "Unused 'getSettings' — searched .xtmOne.getSettings in /front/src." }],
        },
      ],
    });
  });

  it('resolves the file\'s local mounts once, whatever the number of router objects', () => {
    const contents: Array<string> = [];
    const rule = makeUnusedMethodRule({
      description: 'test rule',
      unusedMessage: "Unused '{{methodName}}' — searched {{pattern}} in {{frontSrc}}.",
      selector,
      makeChecker: makeRouterEndpointChecker({
        getContent: () => {
          contents.push('read');
          return 'trpc.jobs.listRuns.queryOptions() trpc.jobs.nested.deepProc.queryOptions()';
        },
        getFactoryMounts: () => new Map([['jobsRouter', 'jobs']]),
        frontSrc: () => '/front/src',
      }),
    });
    ruleTester.run('no-unused-router-endpoint', rule, {
      valid: [{ code: jobsRouterCode('listRuns() {}, nested: router({ deepProc() {} })'), filename: 'jobs-router.ts' }],
      invalid: [],
    });
    expect(contents).toHaveLength(1);
  });
});
