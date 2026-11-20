/**
 * Generate `NOTICE`, the file the Docker image ships beside `LICENSE`, and refuse to when a data
 * file has no entry in the registry.
 *
 * Usage: node scripts/notice.mjs [--check]
 *   --check  compare instead of writing, and exit 1 on any difference (this is what CI runs)
 *
 * The registry in `scripts/notice/registry.mjs` classifies every data file: a third-party work with
 * its notice, a reviewed work that needs none, or first-party data. The notices of the third-party
 * software are not written here.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkVersions,
  classifyDataFiles,
  listDataFiles,
  normalizeText,
  renderNotice,
} from './notice/lib.mjs';
import {
  DATASETS,
  FIRST_PARTY,
  IGNORED,
  REVIEWED,
  RUNTIME_SOURCES,
} from './notice/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = 'NOTICE';

const fail = (problems) => {
  process.stderr.write(`${problems.map((problem) => `notice: ${problem}`).join('\n')}\n`);
  process.exit(1);
};

const check = process.argv.includes('--check');

const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (listed.status !== 0) {
  fail([`git ls-files failed: ${listed.stderr}`]);
}
const dataFiles = listDataFiles(ROOT, listed.stdout.split('\0').filter(Boolean), IGNORED);
const classification = classifyDataFiles(dataFiles, [
  ...DATASETS.map(({ id, files }) => ({ label: `dataset ${id}`, files })),
  ...REVIEWED.map(({ reason, files }) => ({ label: `reviewed (${reason})`, files })),
  ...FIRST_PARTY.map(({ reason, files }) => ({ label: `first party (${reason})`, files })),
]);
const problems = [
  ...classification.unclassified.map((file) => `data file with no entry in scripts/notice/registry.mjs: ${file}`),
  ...classification.stale.map((entry) => `registry path that names no data file: ${entry}`),
  ...checkVersions(ROOT, DATASETS),
];
if (problems.length > 0) {
  fail(problems);
}

const rendered = renderNotice({
  datasets: DATASETS,
  runtimeSources: RUNTIME_SOURCES,
  firstParty: FIRST_PARTY,
  noticeText: (file) => fs.readFileSync(path.join(ROOT, 'scripts/notice/notices', file), 'utf8'),
});
const target = path.join(ROOT, OUTPUT);

if (check) {
  if (!fs.existsSync(target) || normalizeText(fs.readFileSync(target, 'utf8')) !== rendered) {
    fail([`${OUTPUT} differs from what the registry renders: run \`yarn notice:build\` and commit the result`]);
  }
  process.stdout.write(`notice: ${OUTPUT} is up to date (${dataFiles.length} data files classified)\n`);
} else {
  fs.writeFileSync(target, rendered);
  process.stdout.write(`notice: wrote ${OUTPUT} (${dataFiles.length} data files classified)\n`);
}
