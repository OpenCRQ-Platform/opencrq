/**
 * Builds the drift agent's detection contexts on a throwaway repository, and pins that every file
 * an audit needs reaches a call, whatever its size. Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASK_AGENT = path.join(ROOT, '.github/docs-drift/scripts/ask-agent.js');
const DRIFT_CONTEXT = pathToFileURL(path.join(ROOT, '.github/docs-drift/scripts/drift-context.js'));
const MAX = 20000;
const NEXT_CALL = '\n\n<<<<<<<< next call >>>>>>>>\n\n';

const linesOf = (name, count, width = 60) =>
  Array.from({ length: count }, (_, i) => `export const ${name}${i} = '${'x'.repeat(width)}';`).join('\n');

// Backtick runs long enough that the fences of a part outgrow a fixed allowance.
const TICKS = Array.from({ length: 30 }, () => '`'.repeat(1500)).join('\n');

let repo;
let base;

const git = (...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();

const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};

const contexts = (changed) => {
  fs.writeFileSync(path.join(repo, 'pair.json'), JSON.stringify({ doc: 'docs/guide.md', changed }));
  const run = spawnSync('node', [ASK_AGENT, 'context', 'detect', 'pair.json'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, MAX_CONTEXT_BYTES: String(MAX), MAP_FILE: 'map.yml', BASE: base },
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trimEnd().split(NEXT_CALL);
};

// In process, for `unaudited`, which the `context` command does not print. The module reads the
// size cap when it loads.
const detect = async (changed) => {
  process.env.MAX_CONTEXT_BYTES = String(MAX);
  process.env.MAP_FILE = 'map.yml';
  const { detectContexts } = await import(DRIFT_CONTEXT);
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    return detectContexts({ doc: 'docs/guide.md', changed }, base);
  } finally {
    process.chdir(cwd);
  }
};

// The numbered lines of `file` across every call, in the order the calls carry them: the
// content is the one block of its sections with no language, a diff block is tagged `diff`.
const sentLines = (calls, file) =>
  calls
    .flatMap((context) => context.split(/\n\n(?=## )/))
    .filter((section) => section.startsWith(`## File \`${file}\``))
    .flatMap((section) => [...section.matchAll(/(`{3,})(\w*)\n([\s\S]*?)\n\1(?:\n|$)/g)])
    .filter((m) => m[2] === '')
    .flatMap((m) => m[3].split('\n'));

const numbered = (text) =>
  text
    .split('\n')
    .map((line, i) => `${i + 1}\t${line}`);

describe('docs drift detection contexts', () => {
  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-drift-'));
    git('init', '-q');
    write('map.yml', '- doc: docs/guide.md\n  watches:\n    - src/**\n');
    write('docs/guide.md', '# Guide\n\nSee `src/a.ts`.\n');
    write('src/a.ts', linesOf('a', 150));
    write('src/b.ts', linesOf('b', 150));
    write('src/big.ts', linesOf('big', 600));
    write('src/small.ts', linesOf('small', 5));
    write('src/long.ts', 'x'.repeat(MAX * 2));
    write('src/minified.ts', 'y'.repeat(MAX * 2));
    write('src/ticks.md', TICKS);
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    base = git('rev-parse', 'HEAD');
    write('src/a.ts', linesOf('a', 160));
    write('src/b.ts', linesOf('b', 160));
    write('src/big.ts', linesOf('big', 620));
    write('src/minified.ts', linesOf('min', 5));
    git('commit', '-q', '-am', 'change');
  });

  it('spreads changed files that do not fit one call over several, each within the limit', () => {
    const calls = contexts(['src/a.ts', 'src/b.ts']);
    assert.equal(calls.length, 2);
    calls.forEach((context) => assert.ok(Buffer.byteLength(context) <= MAX));
    for (const file of ['src/a.ts', 'src/b.ts']) {
      assert.deepEqual(sentLines(calls, file), numbered(fs.readFileSync(path.join(repo, file), 'utf8')));
    }
    assert.match(calls.join(''), /```diff\n/);
  });

  it('adds unchanged files only where room is left, without opening a call for them', () => {
    const calls = contexts(['src/a.ts', 'src/b.ts']);
    assert.equal(sentLines(calls, 'src/small.ts').length, 5);
    assert.equal(sentLines(calls, 'src/big.ts').length, 0);
    assert.match(calls[0], /## Files omitted for size[\s\S]*- src\/big\.ts\n/);
  });

  it('cuts a file larger than a call into parts that keep its line numbers', () => {
    const calls = contexts([]);
    calls.forEach((context) => assert.ok(Buffer.byteLength(context) <= MAX));
    assert.match(calls.join(''), /## File `src\/big\.ts`, lines 1 to \d+ of 620/);
    assert.deepEqual(sentLines(calls, 'src/big.ts'), numbered(linesOf('big', 620)));
    assert.match(calls.join(''), /- src\/big\.ts \(its other lines\)/);
    assert.deepEqual(sentLines(calls, 'src/ticks.md'), numbered(TICKS));
  });

  it('names a file whose single line is longer than a call as not sent', () => {
    const calls = contexts([]);
    assert.match(calls[0], /- src\/long\.ts \(a line longer than one call\)/);
  });

  it('cuts a changed file larger than a call, its diff included, in a weekly audit', async () => {
    const { contexts: found, unaudited } = await detect(['src/big.ts']);
    const calls = found.map((c) => c.context);
    calls.forEach((context) => assert.ok(Buffer.byteLength(context) <= MAX));
    assert.match(calls.join(''), /## Diff of `src\/big\.ts`, diff lines 1 to \d+ of \d+\n\n```diff\n[\s\S]*\n\+export const big619 /);
    assert.deepEqual(sentLines(calls, 'src/big.ts'), numbered(linesOf('big', 620)));
    assert.match(calls[0], /## Files omitted for size[\s\S]*- src\/long\.ts$/m);
    assert.deepEqual(unaudited, []);
  });

  it('reports as unaudited a changed file that no call carries', async () => {
    const { unaudited } = await detect(['src/long.ts']);
    assert.deepEqual(unaudited, ['src/long.ts (a line longer than one call)']);
  });

  it('reads a page of the site from DOC_ROOT and names none of its paths as files of this repository', () => {
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-drift-site-'));
    const page = 'docs/content/opencrq/page.md';
    fs.mkdirSync(path.join(site, path.dirname(page)), { recursive: true });
    fs.writeFileSync(path.join(site, page), '# Page\n\nSee `src/gone.ts` and [the guide](../guide/).\n');
    fs.writeFileSync(path.join(repo, 'site-map.yml'), `- doc: ${page}\n  watches:\n    - src/small.ts\n`);
    fs.writeFileSync(path.join(repo, 'pair.json'), JSON.stringify({ doc: page, changed: [] }));
    const run = spawnSync('node', [ASK_AGENT, 'context', 'detect', 'pair.json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, MAX_CONTEXT_BYTES: String(MAX), MAP_FILE: 'site-map.yml', DOC_ROOT: site },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /## Document `docs\/content\/opencrq\/page\.md`\n\n```markdown\n# Page\n/);
    assert.doesNotMatch(run.stdout, /## Paths named in the document/);
    assert.deepEqual(sentLines([run.stdout], 'src/small.ts'), numbered(linesOf('small', 5)));
  });

  it('still sends the current content of a changed file whose diff cannot be cut', async () => {
    const { contexts: found, unaudited } = await detect(['src/minified.ts']);
    const calls = found.map((c) => c.context);
    calls.forEach((context) => assert.ok(Buffer.byteLength(context) <= MAX));
    assert.match(calls.join(''), /## Diff of `src\/minified\.ts`\n\nNot sent: /);
    assert.deepEqual(sentLines(calls, 'src/minified.ts'), numbered(linesOf('min', 5)));
    assert.deepEqual(unaudited, []);
  });
});
