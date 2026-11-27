import type { TSESTree } from '@typescript-eslint/utils';
import fs from 'node:fs';
import path from 'node:path';

// Minimal structural type covering only what the rule implementations use.
// Using a full RuleContext from @typescript-eslint/utils is not viable here
// because it includes deprecated ESLint <9 APIs (getAncestors, parserOptions…)
// that ESLint 9 no longer provides, causing type incompatibilities.
type RuleContext = {
  report: (descriptor: { node: TSESTree.Node, messageId: string, data?: Record<string, string> }) => void,
};

// Walk up the directory tree to find the monorepo root (first package.json with "workspaces").
// This is robust to folder renames or depth changes.
const findMonorepoRoot = (startDir: string): string => {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse from known package.json files; shape validated by usage
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      if (pkg['workspaces']) {
        return dir;
      }
    } catch { /* not found or unreadable — keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`[app/no-unused-endpoint] Could not locate monorepo root from ${startDir}`);
    }
    dir = parent;
  }
};

const MONOREPO_ROOT = (() => {
  try {
    return findMonorepoRoot(path.dirname(new URL(import.meta.url).pathname));
  } catch {
    // Fallback to cwd when import.meta.url resolves unexpectedly (e.g. bundled CI runners).
    return findMonorepoRoot(process.cwd());
  }
})();

// Build a map from npm package name → absolute src/ path by reading
// workspaces from root package.json and each workspace's package.json.
// This avoids hardcoding folder names: if a workspace is renamed, only
// root package.json needs to be updated — this plugin self-heals.
// Computed once per process; safe because lint runs never modify package.json.
let workspaceSrcCache: Map<string, string> | undefined;

const getWorkspaceSrcMap = (): Map<string, string> => {
  if (workspaceSrcCache !== undefined) {
    return workspaceSrcCache;
  }
  let rootPkg: { workspaces?: Array<string> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse from known package.json files; shape validated by usage
    rootPkg = JSON.parse(
      fs.readFileSync(path.join(MONOREPO_ROOT, 'package.json'), 'utf-8'),
    ) as { workspaces?: Array<string> };
  } catch {
    workspaceSrcCache = new Map();
    return workspaceSrcCache;
  }
  const map = new Map<string, string>();
  for (const workspace of rootPkg.workspaces ?? []) {
    const wsPkgPath = path.join(MONOREPO_ROOT, workspace, 'package.json');
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse from known package.json files; shape validated by usage
      const wsPkg = JSON.parse(fs.readFileSync(wsPkgPath, 'utf-8')) as { name?: string };
      if (wsPkg.name) {
        map.set(wsPkg.name, path.join(MONOREPO_ROOT, workspace, 'src'));
      }
    } catch { /* workspace folder may have no package.json — skip */ }
  }
  workspaceSrcCache = map;
  return map;
};

/**
 * Returns the absolute path to the `src/` directory of a workspace, looked up
 * by npm package name (e.g. `'@app/module'`).
 * Throws a descriptive error if the package is not found, so misconfiguration
 * is immediately visible instead of silently producing empty content.
 */
const workspaceSrc = (packageName: string): string => {
  const srcPath = getWorkspaceSrcMap().get(packageName);
  if (srcPath === undefined) {
    throw new Error(
      `[app/no-unused-endpoint] Workspace '${packageName}' not found in root package.json workspaces. Check that the package name matches exactly.`,
    );
  }
  return srcPath;
};

// --- Per-process content cache with TTL so watch mode stays accurate ---
const CACHE_TTL_MS = 5_000; // re-scan after 5 s; safe for typical watch-mode edits

type CacheEntry = { content: string, computedAt: number };
const dirContentCache = new Map<string, CacheEntry>();

/**
 * Strip comments from TypeScript source so that a `.methodName(` pattern search
 * is not fooled by method names mentioned inside comments.
 *
 * String literals are intentionally left in place — stripping them correctly
 * requires a state machine that interleaves comment and string logic (because
 * `//` can appear inside a string and `'` can appear inside a line comment).
 * In practice, no one writes `.methodName(` inside a string literal, so the
 * false-positive risk is negligible.
 *
 * Known limitation: `//` inside a string literal (e.g. `"http://example.com"`)
 * is incorrectly treated as the start of a line comment, erasing the rest of
 * the line. Fixing this properly requires a full lexer. This is acceptable
 * because `.methodName(` patterns do not realistically follow a URL on the
 * same line.
 */
export const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ');       // line comments

/**
 * Joins a method chain that a formatter wrapped onto the next line (e.g.
 * `trpc.attackOutcomes\n  .listRuns.queryOptions(...)`), so a qualified
 * `.mountKey.methodName(` search is not defeated by line-length wrapping. A
 * leading `.` can only continue the previous expression's member access, so
 * removing the whitespace before it is safe regardless of what that
 * expression is.
 */
export const collapseWrappedMemberAccess = (source: string): string =>
  source.replace(/\s+\./g, '.');

export const collectTsContent = (dir: string): string => {
  const cached = dirContentCache.get(dir);
  if (cached !== undefined && Date.now() - cached.computedAt < CACHE_TTL_MS) {
    return cached.content;
  }
  if (!fs.existsSync(dir)) {
    dirContentCache.set(dir, { content: '', computedAt: Date.now() });
    return '';
  }
  let raw = '';
  const walk = (d: string): void => {
    let entries: Array<fs.Dirent>;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        try {
          // Strip each file individually before concatenating so that string
          // literals or comments in one file cannot accidentally span into the
          // next file's code when the regex is applied to the joined string.
          raw += `${collapseWrappedMemberAccess(stripComments(fs.readFileSync(fullPath, 'utf-8')))}\n`;
        } catch { /* ignore unreadable files */ }
      }
    }
  };
  walk(dir);
  dirContentCache.set(dir, { content: raw, computedAt: Date.now() });
  return raw;
};

/** Returns the Identifier-keyed Property nodes of an ObjectExpression. */
const getIdentifierProperties = (objNode: TSESTree.ObjectExpression): Array<TSESTree.ObjectExpressionProperty & { key: TSESTree.Identifier }> =>
  objNode.properties.filter(
    (p): p is TSESTree.ObjectExpressionProperty & { key: TSESTree.Identifier } =>
      p.type === 'Property' && p.key.type === 'Identifier',
  );

// ─── Known limitation — shared CRUD method names (rules 1 & 2 only) ──────────
//
// Rules 1 and 2 use substring search (.includes) across concatenated workspace
// source, with no notion of which repository or service a method belongs to. If
// two modules both define a method named e.g. `findById`, a call to module A's
// method will also satisfy the check for module B's — producing a silent false
// negative. This is an accepted trade-off: the rules catch obviously dead code
// (uniquely-named methods). They do NOT guarantee exhaustive dead-code detection
// across modules that share common CRUD method names.
//
// They read the same collected content as rule 3, so a call site a formatter
// wrapped onto the next line counts as a call for them too (see
// collapseWrappedMemberAccess); that only ever turns a report into silence.
//
// Rule 3 (no-unused-router-endpoint) qualifies its search by the client path of
// the `router({...})` object being linted (e.g. `.jobs.listRuns(` instead of
// bare `.listRuns(`), so two routers sharing a procedure name no longer satisfy
// each other's check — see `mountPathFor` below. A router merged at the root of
// the client has an empty path, so its procedures keep the unqualified search
// and the limitation above.

// ─── Shared rule factory ──────────────────────────────────────────────────────
//
// All three rules share the same structure: listen to a selector, iterate over
// identifier properties of the matched ObjectExpression, check whether the method
// name appears in the collected workspace content, and report if not.
//
// makeChecker runs once per linted file, with that file's own source; the matched
// node is then handed to every call, because rule 3 resolves a client path per
// `router({...})` object and a file can hold several.
//
// Exported for unit testing: tests inject a fake checker instead of the real
// filesystem-backed one.

export const makeUnusedMethodRule = ({
  description,
  unusedMessage,
  selector,
  makeChecker,
}: {
  description: string,
  unusedMessage: string,
  selector: string,
  makeChecker: (lintedSource: string) => {
    isUsed: (methodName: string, node: TSESTree.ObjectExpression) => boolean,
    msgData: (methodName: string, node: TSESTree.ObjectExpression) => Record<string, string>,
  },
}) => ({
  meta: {
    type: 'problem' as const,
    docs: { description },
    messages: { unused: unusedMessage },
    schema: [],
  },
  create(context: RuleContext) {
    // Widening RuleContext with `sourceCode: { text: string }` does not type-check:
    // ESLint 9's SourceCode is a union that includes BinarySourceCode, which has no `text`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the real RuleContext always exposes sourceCode.text at runtime
    const { sourceCode } = context as unknown as { sourceCode: { text: string } };
    const { isUsed, msgData } = makeChecker(sourceCode.text);
    return {
      [selector]: (node: TSESTree.ObjectExpression) => {
        for (const prop of getIdentifierProperties(node)) {
          const methodName = prop.key.name;
          if (!isUsed(methodName, node)) {
            context.report({ node: prop.key, messageId: 'unused', data: msgData(methodName, node) });
          }
        }
      },
    };
  },
});

// ─── Rule 1: no-unused-repo-method ───────────────────────────────────────────
//
// Applied to: module/src/modules/**/repository.ts
// Checks that every key in defineRepository({...}) is referenced as
// .<key>( anywhere in @app/module/src or @app/back/src
// (services, engines, seeders, etc.).

export const noUnusedRepoMethod = makeUnusedMethodRule({
  description: 'Disallow repository methods that are not called as repo.<method> in the sibling service.ts.',
  unusedMessage: "Repository method '{{methodName}}' is never called as .{{methodName}}( in {{moduleSrc}} or {{backSrc}}. Remove it or add a // eslint-disable-next-line app/no-unused-repo-method -- <reason> comment.",
  selector: 'CallExpression[callee.name="defineRepository"] > ObjectExpression',
  makeChecker: () => {
    const content = collectTsContent(workspaceSrc('@app/module')) + collectTsContent(workspaceSrc('@app/back'));
    return {
      // Search for .methodName( to cover repo.method(, atomicRepo.method(, etc.
      isUsed: (methodName) => content.includes(`.${methodName}(`),
      msgData: (methodName) => ({
        methodName,
        moduleSrc: workspaceSrc('@app/module'),
        backSrc: workspaceSrc('@app/back'),
      }),
    };
  },
});

// ─── Rule 2: no-unused-service-method ────────────────────────────────────────
//
// Applied to: module/src/modules/**/service.ts
// Checks that every key in .implement({...}) is referenced as
// .<key>( somewhere in back/src/ (routers, engines) or in
// module/src/ (inter-service deps calls).

export const noUnusedServiceMethod = makeUnusedMethodRule({
  description: 'Disallow service methods that are not called from back or inter-service dependencies.',
  unusedMessage: "Service method '{{methodName}}' is never called as .{{methodName}}( in {{backSrc}} or {{moduleSrc}}. Remove it or add a // eslint-disable-next-line app/no-unused-service-method -- <reason> comment.",
  // The :has() guard restricts matches to .implement({}) calls that are part of a
  // defineService(...).implement or defineService(...).dependsOn(...).implement chain,
  // preventing false positives from unrelated libs that also expose .implement().
  selector: 'CallExpression[callee.property.name="implement"]:has(CallExpression[callee.name="defineService"]) > ObjectExpression',
  makeChecker: () => {
    const content = collectTsContent(workspaceSrc('@app/back')) + collectTsContent(workspaceSrc('@app/module'));
    return {
      isUsed: (methodName) => content.includes(`.${methodName}(`),
      msgData: (methodName) => ({
        methodName,
        backSrc: workspaceSrc('@app/back'),
        moduleSrc: workspaceSrc('@app/module'),
      }),
    };
  },
});

// ─── Rule 3: no-unused-router-endpoint ───────────────────────────────────────
//
// Applied to: back/src/features/**/*-router.ts
//             (excluding app-router-router.ts which is the top-level aggregator)
// Checks that every key of a `router({...})` object is referenced as
// .<clientPath>.<key>. or .<clientPath>.<key>( somewhere in front/src/ (the tRPC
// React client call sites), where <clientPath> is where that particular object
// sits in the client's procedure tree.
//
// A router reaches the client one of two ways, and the path follows from which:
// mounted under a key in app-router-router.ts (`jobs: jobsRouter(authProcedure)`,
// hence `.jobs.`), or handed to registerRouter, which mergeRouters folds into the
// root — so its own keys are root-level and its path is empty. Either way the
// keys of the enclosing `router({...})` objects inside the file complete it, so
// `router({ events: router({ onDataChanged }) })` resolves to `.events.onDataChanged`.
//
// The front always calls through the qualified client (trpcClient.<path>.
// <procedure>), so qualifying the search this way removes the false negative
// that substring search alone produces when two routers share a procedure name
// (e.g. connectors.listRuns and jobs.listRuns). A call site that aliased part of
// the path into a variable would defeat it and be reported; the message names the
// pattern that was searched, so that reads as the cause instead of a riddle.

/**
 * Maps each router factory name to the key it is mounted under, from the
 * `<mountKey>: <factoryName>(...)` call sites of a source — app-router-router.ts
 * for what the aggregator mounts.
 */
export const extractFactoryToMountKey = (aggregatorSource: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const match of aggregatorSource.matchAll(/(\w+):\s*(\w+Router)\(/g)) {
    map.set(match[2], match[1]);
  }
  return map;
};

/** A factory mounted by a wrapper declared in the same file, and by which wrapper. */
export type LocalMount = { mountKey: string, owner: string | undefined };

/**
 * The same mount sites read inside the linted file, where a wrapper mounts another
 * of the file's factories (`xtmOneRootRouter` mounting `xtmOne: xtmOneRouter(...)`).
 * The owner is the `export const` a mount site follows — a factory is always
 * declared that way, and a bare `const` would let a local binding inside a
 * factory body claim the mounts after it — so the mounted factory inherits the
 * wrapper's own path instead of being read as if it were mounted at the root.
 */
export const extractLocalMounts = (routerSource: string): Map<string, LocalMount> => {
  const map = new Map<string, LocalMount>();
  let owner: string | undefined;
  for (const match of routerSource.matchAll(/export const (\w+)\s*=|(\w+):\s*(\w+Router)\(/g)) {
    if (match[1] !== undefined) {
      owner = match[1];
    } else {
      map.set(match[3], { mountKey: match[2], owner });
    }
  }
  return map;
};

/**
 * The client path of a router factory: the aggregator's mount key when it has
 * one, its wrapper's path followed by the local mount key when a wrapper in the
 * same file mounts it, and empty otherwise — which is what registerRouter really
 * does: mergeRouters folds the router into the root, so its own keys are the
 * client's root keys.
 */
export const mountPathForFactory = (
  factoryName: string | undefined,
  factoryToMountKey: Map<string, string>,
  localMounts: Map<string, LocalMount>,
  seen: ReadonlySet<string> = new Set(),
): Array<string> => {
  if (factoryName === undefined || seen.has(factoryName)) {
    return [];
  }
  const mountKey = factoryToMountKey.get(factoryName);
  if (mountKey !== undefined) {
    return [mountKey];
  }
  const local = localMounts.get(factoryName);
  if (local === undefined) {
    return [];
  }
  return [
    ...mountPathForFactory(local.owner, factoryToMountKey, localMounts, new Set([...seen, factoryName])),
    local.mountKey,
  ];
};

// ESLint hands Program a null parent where the TSESTree types promise undefined,
// so an ancestor walk that only tests for undefined runs off the top of the tree.
const parentOf = (node: TSESTree.Node): TSESTree.Node | undefined => node.parent ?? undefined;

const isRouterCall = (node: TSESTree.Node | undefined): boolean =>
  node?.type === 'CallExpression'
  && node.callee.type === 'Identifier'
  && node.callee.name === 'router';

/**
 * The keys of the `router({...})` objects the given one is nested in, outermost
 * first: `[]` for a factory's own router object, `['events']` for the object
 * behind `router({ events: router({...}) })`.
 */
const enclosingRouterKeys = (objNode: TSESTree.ObjectExpression): Array<string> => {
  const keys: Array<string> = [];
  let node = parentOf(objNode);
  while (node !== undefined) {
    const holder = parentOf(node);
    if (
      node.type === 'Property'
      && node.key.type === 'Identifier'
      && holder?.type === 'ObjectExpression'
      && isRouterCall(parentOf(holder))
    ) {
      keys.unshift(node.key.name);
    }
    node = parentOf(node);
  }
  return keys;
};

/**
 * The `const <name> = ...` declaration a node sits in — the router factory that
 * owns it. Undefined when the object is not declared through one, in which case
 * nothing names its mount and the path stays empty.
 */
const enclosingFactoryName = (objNode: TSESTree.ObjectExpression): string | undefined => {
  let node: TSESTree.Node | undefined = objNode;
  while (node !== undefined) {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      return node.id.name;
    }
    node = parentOf(node);
  }
  return undefined;
};

/** The full client path of one `router({...})` object: its factory's, then its nesting. */
const mountPathFor = (
  objNode: TSESTree.ObjectExpression,
  factoryToMountKey: Map<string, string>,
  localMounts: Map<string, LocalMount>,
): Array<string> => [
  ...mountPathForFactory(enclosingFactoryName(objNode), factoryToMountKey, localMounts),
  ...enclosingRouterKeys(objNode),
];

// Workspace folders are resolved from package.json (see workspaceSrc), but the
// aggregator's own location inside back/src is a convention this rule has to
// know; eslint.config.ts spells out the same path in its `ignores`.
const AGGREGATOR_PATH_IN_BACK_SRC = ['features', 'app-router', 'app-router-router.ts'];

// Cached like dirContentCache: app-router-router.ts is read once per TTL window
// rather than once per linted router file.
type MountKeyCacheEntry = { map: Map<string, string>, computedAt: number };
let mountKeyCache: MountKeyCacheEntry | undefined;

export const getFactoryToMountKey = (): Map<string, string> => {
  if (mountKeyCache !== undefined && Date.now() - mountKeyCache.computedAt < CACHE_TTL_MS) {
    return mountKeyCache.map;
  }
  const aggregatorPath = path.join(workspaceSrc('@app/back'), ...AGGREGATOR_PATH_IN_BACK_SRC);
  let aggregatorSource: string;
  try {
    aggregatorSource = fs.readFileSync(aggregatorPath, 'utf-8');
  } catch {
    // Loud like workspaceSrc: an empty map would silently drop every router back
    // to the unqualified search, and nothing downstream would look any different.
    throw new Error(
      `[app/no-unused-router-endpoint] Could not read the tRPC aggregator at ${aggregatorPath}. Update AGGREGATOR_PATH_IN_BACK_SRC if it moved.`,
    );
  }
  mountKeyCache = { map: extractFactoryToMountKey(aggregatorSource), computedAt: Date.now() };
  return mountKeyCache.map;
};

/**
 * The call-site prefix a procedure must appear under: `.jobs.listRuns` under the
 * jobs mount, `.events.onDataChanged` one level down, the router-blind
 * `.listRuns` for a router merged at the root of the client.
 */
export const routerEndpointPattern = (methodName: string, mountPath: Array<string>): string =>
  `.${[...mountPath, methodName].join('.')}`;

/**
 * Rule 3's per-file checker: reads the file's local mounts once, then resolves a
 * client path per `router({...})` object it is asked about. Its dependencies are
 * injected so tests can exercise it without the filesystem.
 */
export const makeRouterEndpointChecker = ({
  getContent,
  getFactoryMounts,
  frontSrc,
}: {
  getContent: () => string,
  getFactoryMounts: () => Map<string, string>,
  frontSrc: () => string,
}) => (routerSource: string) => {
  const content = getContent();
  const factoryToMountKey = getFactoryMounts();
  const localMounts = extractLocalMounts(routerSource);
  const patternFor = (methodName: string, node: TSESTree.ObjectExpression): string =>
    routerEndpointPattern(methodName, mountPathFor(node, factoryToMountKey, localMounts));
  return {
    // `<pattern>(` covers a direct call and `<pattern>.` a tRPC hook chain
    // (`.listRuns.queryOptions(...)`). The explicit trailing character prevents a
    // prefix collision (e.g. "list" matching ".listScenarios.queryOptions").
    isUsed: (methodName: string, node: TSESTree.ObjectExpression): boolean => {
      const pattern = patternFor(methodName, node);
      return content.includes(`${pattern}(`) || content.includes(`${pattern}.`);
    },
    msgData: (methodName: string, node: TSESTree.ObjectExpression): Record<string, string> => ({
      methodName,
      pattern: patternFor(methodName, node),
      frontSrc: frontSrc(),
    }),
  };
};

export const noUnusedRouterEndpoint = makeUnusedMethodRule({
  description: 'Disallow tRPC router endpoints that are not referenced in front/src.',
  unusedMessage: "tRPC endpoint '{{methodName}}' is never referenced as {{pattern}} in {{frontSrc}}. Remove it or add a // eslint-disable-next-line app/no-unused-router-endpoint -- <reason> comment.",
  selector: 'CallExpression[callee.name="router"] > ObjectExpression',
  makeChecker: makeRouterEndpointChecker({
    getContent: () => collectTsContent(workspaceSrc('@app/front')),
    getFactoryMounts: getFactoryToMountKey,
    frontSrc: () => workspaceSrc('@app/front'),
  }),
});
