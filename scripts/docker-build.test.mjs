/**
 * Pins what lets the Docker build job reuse its layers: the cache roles of `ci-docker-build.yml`,
 * the order of `docker/prod.dockerfile` (manifests before `yarn install`, a `notices` stage fed only
 * the files the checker reads) and the allowlist of `.dockerignore`. A file the build copies but the
 * allowlist leaves out, or a workspace added without its manifest, fails here rather than in the
 * Docker build job. Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const STEPS = parse(read('.github/workflows/ci-docker-build.yml')).jobs.build.steps;
const FLOW_STEPS = parse(read('.github/workflows/flow-gdl-xtm-0002.yml')).jobs.licenses.steps;
const action = (step) => step.uses?.split('@')[0];
const BUILD = STEPS.find((step) => action(step) === 'docker/build-push-action');
const RESOLVE = STEPS.find((step) => step.name === 'Resolve layer cache');

const WORKSPACES = JSON.parse(read('package.json')).workspaces;
const MANIFESTS = ['package.json', 'yarn.lock', '.yarnrc.yml', ...WORKSPACES.map((w) => `${w}/package.json`)];

/** The Dockerfile's instructions per stage, continuations joined and comments dropped. */
const stages = () => {
  const out = {};
  let current;
  const text = read('docker/prod.dockerfile').replace(/\\\n/g, ' ');
  for (const line of text.split('\n').map((l) => l.trim())) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === 'FROM') {
      const as = rest.findIndex((word) => word.toUpperCase() === 'AS');
      current = as >= 0 ? rest[as + 1] : 'final';
      out[current] = [];
    } else if (current) {
      out[current].push({ keyword, args: rest });
    }
  }
  return out;
};

/** The build-context sources of a COPY, without its flags and its destination; none for `--from`. */
const sources = ({ keyword, args }) => {
  if (keyword !== 'COPY' || args.some((arg) => arg.startsWith('--from='))) {
    return [];
  }
  return args.filter((arg) => !arg.startsWith('--')).slice(0, -1);
};

const resolveCache = (ref) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-cache-'));
  const output = path.join(dir, 'output');
  fs.writeFileSync(output, '');
  try {
    const result = spawnSync('bash', ['-c', RESOLVE.run], {
      env: { PATH: process.env.PATH, REF: ref, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(
      fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
};

describe('docker build workflow', () => {
  it('reads the layer cache on every build, and writes it from main only', () => {
    const readCache = 'type=gha,scope=opencrq-platform';
    const writeCache = 'type=gha,mode=max,scope=opencrq-platform';
    assert.deepEqual(resolveCache('refs/heads/main'), { cache_from: readCache, cache_to: writeCache });
    assert.deepEqual(resolveCache('refs/pull/1/merge'), { cache_from: readCache, cache_to: '' });
    assert.deepEqual(resolveCache('refs/tags/0.261116.0'), { cache_from: readCache, cache_to: '' });
    assert.deepEqual(Object.keys(RESOLVE.env), ['REF']);
    assert.equal(BUILD.with['cache-from'], `\${{ steps.${RESOLVE.id}.outputs.cache_from }}`);
    assert.equal(BUILD.with['cache-to'], `\${{ steps.${RESOLVE.id}.outputs.cache_to }}`);
  });

  // An Actions cache entry is found only under the key prefix and the paths it was saved with:
  // a Flow distribution that changes either makes this restore miss silently.
  it('restores the checker cache the Flow workflow saves, and never saves it', () => {
    const restore = STEPS.find((step) => action(step) === 'actions/cache/restore');
    const flowRestore = FLOW_STEPS.find((step) => action(step) === 'actions/cache/restore');
    assert.match(restore.with.key, /^flow-gdl-dependencies-/);
    assert.deepEqual(
      { path: restore.with.path, key: restore.with.key, 'restore-keys': restore.with['restore-keys'] },
      { path: flowRestore.with.path, key: flowRestore.with.key, 'restore-keys': flowRestore.with['restore-keys'] },
    );
    assert.ok(STEPS.every((step) => !['actions/cache', 'actions/cache/save'].includes(action(step))));
  });

  it("fills the builder's cache mount the notices stage reads, before the build", () => {
    const fill = STEPS.findIndex((step) => step.run?.includes('--mount=type=cache,id=flow-cache,target=/cache'));
    assert.ok(fill >= 0, 'a step fills the flow-cache mount');
    assert.ok(fill < STEPS.indexOf(BUILD));
    assert.match(STEPS[fill].run, /cp \/in\/licenses\.json \/cache\/licenses\.json/);
    assert.match(STEPS[fill].run, /--build-context flow-cache=\.flow-cache /);
  });
});

describe('prod.dockerfile', () => {
  it('installs the dependencies from the manifests alone, before any source', () => {
    const builder = stages().builder;
    const install = builder.findIndex(({ keyword, args }) => keyword === 'RUN' && args.join(' ') === 'yarn install');
    assert.ok(install > 0, 'builder runs yarn install');
    const copied = builder.slice(0, install).flatMap(sources);
    assert.deepEqual([...copied].sort(), [...MANIFESTS].sort());
  });

  it('gives the notices stage only what the checker reads, every workspace manifest included', () => {
    const copied = stages().notices.flatMap(sources);
    assert.deepEqual([...copied].sort(), [...MANIFESTS, '.flow'].sort());
  });

  it('hands the checker its cache through a cache mount, outside the layer cache key', () => {
    const run = stages()
      .notices.filter(({ keyword }) => keyword === 'RUN')
      .map(({ args }) => args.join(' '))
      .find((command) => command.includes('check.py'));
    assert.match(run, /--mount=type=cache,id=flow-cache,target=\/cache\b/);
    assert.doesNotMatch(run, /--mount=type=(bind|secret)/);
    assert.match(run, /--notices --cache \/cache\/licenses\.json/);
  });

  // The version changes on every commit: above a COPY, it rebuilds that copy on every push.
  it('declares the version after the last copy of the final stage', () => {
    const final = stages().final;
    const lastCopy = final.findLastIndex(({ keyword }) => keyword === 'COPY');
    const version = final.findIndex(
      ({ keyword, args }) => ['ARG', 'ENV'].includes(keyword) && args.join(' ').includes('APP_VERSION'),
    );
    assert.ok(lastCopy >= 0, 'the final stage copies files');
    assert.ok(version > lastCopy, 'APP_VERSION is declared after the last COPY');
  });
});

describe('.dockerignore', () => {
  const rules = read('.dockerignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  it('starts by leaving everything out', () => {
    assert.equal(rules[0], '*');
  });

  // A prefix match on the rules as written, not Docker's matcher: it catches a source no `!` rule
  // names, or one a later rule names again, which is how the allowlist drifts from the Dockerfile.
  it('lets in every file the Dockerfile copies from the build context', () => {
    const copied = new Set(Object.values(stages()).flat().flatMap(sources));
    for (const source of copied) {
      const included = rules.findLastIndex((rule) => {
        if (!rule.startsWith('!')) {
          return false;
        }
        const allowed = rule.slice(1);
        return source === allowed || source.startsWith(`${allowed}/`);
      });
      assert.ok(included > 0, `${source} is re-included`);
      const excluded = rules.slice(included + 1).some((rule) => rule === source);
      assert.ok(!excluded, `${source} is not excluded again`);
    }
  });
});
