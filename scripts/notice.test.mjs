/**
 * The notice generator's rules, run against fixtures, plus the registry against this repository's
 * own data files. No build is started: the full check is `yarn notice:check`.
 * Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkVersions,
  classifyDataFiles,
  isDataFile,
  listDataFiles,
  literalShare,
  normalizeText,
  renderNotice,
} from './notice/lib.mjs';
import { DATASETS, FIRST_PARTY, IGNORED, REVIEWED } from './notice/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('normalizeText', () => {
  it('unifies line endings, drops trailing blanks and ends on one newline', () => {
    assert.equal(normalizeText('\uFEFFa  \r\nb\r\n\r\n\r\n\r\nc\r\n\r\n'), 'a\nb\n\nc\n');
  });
});

describe('literalShare', () => {
  it('measures the string and template literals among the tokens, comments and regular expressions aside', () => {
    assert.ok(literalShare('a.ts', "export const NAMES = { T1003: 'Adversaries may attempt to dump credentials', T1005: 'Adversaries may search local system sources' };") > 0.6);
    assert.ok(literalShare('a.ts', "// 'a long comment that is not data at all'\nexport const clean = (value: string) => value.replace(/[\"']/g, '');") < 0.3);
  });
});

describe('data file classification', () => {
  const dataFiles = ['m/data/a.ts', 'm/data/b.json', 'front/public/logo.svg'];

  it('names the files no entry names and the registry paths that name no data file', () => {
    const { unclassified, stale } = classifyDataFiles(dataFiles, [
      { label: 'first', files: ['m/data/a.ts', 'm/data/gone.ts'] },
      { label: 'second', files: ['front/public/logo.svg'] },
    ]);
    assert.deepEqual(unclassified, ['m/data/b.json']);
    assert.deepEqual(stale, ['first: m/data/gone.ts']);
  });

  it('accepts a file two entries claim', () => {
    const { unclassified } = classifyDataFiles(['m/data/a.ts'], [
      { label: 'one', files: ['m/data/a.ts'] },
      { label: 'two', files: ['m/data/a.ts'] },
    ]);
    assert.deepEqual(unclassified, []);
  });

  const ignored = [{ pattern: /^infra\// }];
  const catalogue = () => `export const WEAKNESSES = {\n${Array.from({ length: 400 }, (_, i) => `  'CWE-${i}': 'A weakness described in a sentence long enough to count.',`).join('\n')}\n};\n`;
  const code = () => 'export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);\n'.repeat(200);

  it('scopes data and fixture directories, assets, models and generated tables, and spares tests and ignored paths', () => {
    for (const file of ['m/src/data/x.ts', 'm/__fixtures__/x.json', 'm/fixtures/x.json', 'm/test-data/x.json', 'back/static/maps/x.pmtiles', 'x/outcome-counter-model/y.json', 'm/x.generated.ts']) {
      assert.ok(isDataFile(file, 10, ignored, code), file);
    }
    assert.ok(!isDataFile('m/data/x.test.ts', 10, ignored, code));
    assert.ok(!isDataFile('back/static/maps/README.md', 10, ignored, code));
    assert.ok(!isDataFile('infra/dashboard.json', 20_000, ignored, code));
  });

  it('counts any file of 10 KB or more that is not code, whatever its extension', () => {
    for (const file of ['m/cwe/catalogue.yaml', 'm/notes.txt', 'm/rows.jsonl', 'm/ontology.ttl', 'm/table.json', 'm/LICENSE']) {
      assert.ok(isDataFile(file, 20_000, ignored, code), file);
      assert.ok(!isDataFile(file, 2_000, ignored, code), file);
    }
    for (const file of ['m/x.js', 'm/x.mjs', 'm/x.css', 'm/x.py', 'm/x.sh', 'm/x.sql', 'm/x.tsx']) {
      assert.ok(!isDataFile(file, 20_000, ignored, catalogue), file);
    }
  });

  it('counts a TypeScript file of 10 KB or more made mostly of string literals, wherever it sits', () => {
    assert.ok(isDataFile('m/cwe/more-weaknesses.ts', 20_000, ignored, catalogue));
    assert.ok(!isDataFile('m/cwe/repository.ts', 20_000, ignored, code));
    assert.ok(!isDataFile('m/cwe/more-weaknesses.ts', 2_000, ignored, catalogue));
  });
});

describe('checkVersions', () => {
  let directory;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-test-'));
    fs.writeFileSync(path.join(directory, 'release.ts'), "export const RELEASE = '20.1';\n");
  });
  after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const dataset = (versions) => ({ id: 'attack', versions });

  it('passes when the code holds the version the registry records', () => {
    assert.deepEqual(checkVersions(directory, [dataset([{ file: 'release.ts', pattern: /RELEASE = '([^']+)'/, expected: '20.1' }])]), []);
  });

  it('fails when a data bump moved the version', () => {
    const problems = checkVersions(directory, [dataset([{ file: 'release.ts', pattern: /RELEASE = '([^']+)'/, expected: '20.0' }])]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /attack: release\.ts says 20\.1, the registry says 20\.0/);
  });

  it('fails when the constant can no longer be found', () => {
    const problems = checkVersions(directory, [dataset([{ file: 'release.ts', pattern: /VERSION = '([^']+)'/, expected: '20.1' }])]);
    assert.match(problems[0], /no version found/);
  });
});

describe('renderNotice', () => {
  const datasets = [{
    id: 'one', title: 'One', release: 'v1', copyrightFrom: 'its README', notice: 'one.txt', files: ['a/b.ts'], versions: [],
  }];
  const firstParty = [
    { reason: 'declared', declaration: 'Filigran internal model.', files: ['m/model/*.json'] },
    { reason: 'silent', files: ['m/other/*.ts'] },
  ];
  const runtimeSources = [{ title: 'Live feed', readBy: 'the feed connector', notice: 'live.txt' }];
  const render = () => renderNotice({ datasets, runtimeSources, firstParty, noticeText: () => 'Copyright 2026 One\r\n' });

  it('carries each dataset with its files, its source and its notice', () => {
    const text = render();
    assert.match(text, /One \(v1\)/);
    assert.match(text, /^ {2}a\/b\.ts$/m);
    assert.match(text, /taken from: its README\./);
    assert.match(text, /^Copyright 2026 One$/m);
  });

  it('declares a first-party entry that has a declaration and renders nothing for the others', () => {
    const text = render();
    assert.match(text, /^Filigran internal model\.$/m);
    assert.ok(text.includes('m/model/*.json'));
    assert.ok(!text.includes('silent') && !text.includes('m/other'));
  });

  it('credits each source fetched at runtime with what fetches it and its notice', () => {
    const [, runtime] = render().split('THIRD-PARTY DATA FETCHED AT RUNTIME');
    assert.match(runtime, /^Live feed$/m);
    assert.match(runtime, /^Fetched by the feed connector when it runs; not shipped with OpenCRQ\.$/m);
    assert.match(runtime, /^Copyright 2026 One$/m);
  });

  it('points to THIRD_PARTY_NOTICES for the third-party software', () => {
    assert.match(render(), /THIRD_PARTY_NOTICES/);
  });

  it('is stable', () => {
    assert.equal(render(), render());
  });
});

describe('the registry against this repository', () => {
  const tracked = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  const dataFiles = listDataFiles(ROOT, tracked.stdout.split('\0').filter(Boolean), IGNORED);

  it('claims every data file and no file that is gone', () => {
    const { unclassified, stale } = classifyDataFiles(dataFiles, [
      ...DATASETS.map(({ id, files }) => ({ label: id, files })),
      ...REVIEWED.map(({ reason, files }) => ({ label: reason, files })),
      ...FIRST_PARTY.map(({ reason, files }) => ({ label: reason, files })),
    ]);
    assert.deepEqual(unclassified, []);
    assert.deepEqual(stale, []);
  });

  it('records the version of every dataset the code carries a version for', () => {
    assert.deepEqual(checkVersions(ROOT, DATASETS), []);
    for (const id of ['mitre-attack', 'mitre-cwe', 'mitre-capec', 'ctid-mappings-explorer']) {
      assert.ok(DATASETS.find((dataset) => dataset.id === id).versions.length > 0, id);
    }
  });

  it('has a notice text and a stated source for every dataset', () => {
    for (const dataset of DATASETS) {
      assert.ok(fs.existsSync(path.join(ROOT, 'scripts/notice/notices', dataset.notice)), dataset.id);
      assert.ok(dataset.release && dataset.copyrightFrom, dataset.id);
    }
  });
});
