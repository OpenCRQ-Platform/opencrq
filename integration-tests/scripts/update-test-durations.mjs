#!/usr/bin/env node
/* eslint-disable no-console */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Feeds the shard sequencer. Point it at the vitest JSON reports every shard of a CI run wrote
// (`gh run download <run-id> -n integration-test-durations`), or at a single local report:
//   node scripts/update-test-durations.mjs ./reports

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(projectRoot, 'test-durations.json');

const collectReports = (target) => {
  if (statSync(target).isDirectory()) {
    return readdirSync(target, { recursive: true })
      .map((entry) => path.join(target, entry.toString()))
      .filter((entry) => entry.endsWith('.json') && statSync(entry).isFile());
  }
  return [target];
};

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('usage: update-test-durations.mjs <vitest-json-report|directory>...');
  process.exit(1);
}

// Reports come off Linux runners, so their absolute paths cannot be made relative to a Windows
// projectRoot: cut at the workspace's own src/ instead.
const toKey = (name) => {
  const normalized = name.split('\\').join('/');
  const index = normalized.lastIndexOf('/src/');
  return index === -1
    ? path.relative(projectRoot, name).split(path.sep).join('/')
    : normalized.slice(index + 1);
};

const durations = {};
let fileCount = 0;

for (const report of inputs.flatMap(collectReports)) {
  const parsed = JSON.parse(readFileSync(report, 'utf8'));
  for (const result of parsed.testResults ?? []) {
    const key = toKey(result.name);
    const ms = Math.round(result.endTime - result.startTime);
    if (Number.isFinite(ms) && ms > 0) {
      durations[key] = Math.max(durations[key] ?? 0, ms);
      fileCount += 1;
    }
  }
}

if (fileCount === 0) {
  console.error('no test file durations found in the given reports');
  process.exit(1);
}

const sorted = Object.fromEntries(Object.entries(durations).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`);

const total = Object.values(sorted).reduce((sum, ms) => sum + ms, 0);
console.log(
  `${outputFile}: ${Object.keys(sorted).length} files, ${(total / 1000).toFixed(0)}s of test time`,
);
