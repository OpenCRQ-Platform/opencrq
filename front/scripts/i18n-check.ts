/* eslint-disable no-console */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(import.meta.dirname, '..', 'src', 'locales');

const collectPoFiles = (dir: string): Array<string> => {
  const results: Array<string> = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectPoFiles(full));
    } else if (entry.endsWith('.po')) {
      results.push(full);
    }
  }
  return results;
}

const snapshot = (files: Array<string>): Map<string, string> => {
  const map = new Map<string, string>();
  for (const file of files) {
    map.set(file, readFileSync(file, 'utf-8'));
  }
  return map;
}

// 1. Snapshot .po files before extraction
const poFiles = collectPoFiles(LOCALES_DIR);
const before = snapshot(poFiles);

// 2. Run lingui extract --clean
console.log('Running lingui extract --clean...');
 
execSync('lingui extract --clean', {
  cwd: join(import.meta.dirname, '..'),
  stdio: 'inherit',
});

// 3. Snapshot .po files after extraction
const afterFiles = collectPoFiles(LOCALES_DIR);
const after = snapshot(afterFiles);

// 4. Compare
const changedFiles: Array<string> = [];
for (const [file, content] of after) {
  if (before.get(file) !== content) {
    changedFiles.push(file);
  }
}
for (const file of afterFiles) {
  if (!before.has(file)) {
    changedFiles.push(file);
  }
}

if (changedFiles.length > 0) {
  console.error('');
  console.error(
    'ERROR: i18n catalog files are not up to date with the source code.',
  );
  console.error(
    "Run 'yarn i18n:extract' and commit the updated .po files.",
  );
  console.error('');
  console.error('Changed files:');
  for (const file of changedFiles) {
    console.error(`  - ${file}`);
  }
  process.exit(1);
}

console.log('Catalogs are up to date.');

// 5. Run lingui compile --strict
console.log('Running lingui compile --strict...');
 
execSync('lingui compile --strict', {
  cwd: join(import.meta.dirname, '..'),
  stdio: 'inherit',
});

console.log('i18n check passed.');
