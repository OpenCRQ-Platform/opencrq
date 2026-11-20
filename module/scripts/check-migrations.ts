/* eslint-disable no-console */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLES_WITHOUT_DATA_CHANGED_TRIGGER } from '../src/db/migration-conventions';

if (!process.env.CI || process.env.CI !== 'true') {
  console.log('Skipping migration check: not running in CI environment.');
  process.exit(0);
}

const run = (cmd: string): string =>
  execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });

console.log('Checking migration consistency...');
run('npx drizzle-kit check');

console.log('Checking migrations are up to date with schema...');
run('npx drizzle-kit generate');

const status = run('git status --porcelain -- src/db/migrations/').trim();
if (status) {
  console.error('');
  console.error('ERROR: Migration files are not up to date with the schema.');
  console.error("Run 'yarn db:generate' in module and commit the results.");
  console.error('');
  execSync('git status -- src/db/migrations/', { stdio: 'inherit' });
  process.exit(1);
}

console.log('Migrations are up to date.');

// --- Check that every table has a data_changed notify trigger ---
console.log('Checking data_changed triggers coverage...');

const migrationsDir = join(process.cwd(), 'src/db/migrations');

const allMigrationsSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf-8'))
  .join('\n');

// Parse table names from the SQL rather than the TS source: SQL syntax is uniform and Drizzle
// always emits quoted identifiers, so a regex is reliable.
const createTableRegex = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"(\w+)"/g;
const allTableNames = new Set<string>();
for (const match of allMigrationsSql.matchAll(createTableRegex)) {
  allTableNames.add(match[1]);
}

// Drop tables later renamed or dropped — they no longer exist under their original name.
const renameTableRegex = /ALTER TABLE\s+"(\w+)"\s+RENAME TO\s+"(\w+)"/g;
for (const match of allMigrationsSql.matchAll(renameTableRegex)) {
  allTableNames.delete(match[1]);
}
const dropTableRegex = /DROP TABLE\s+"(\w+)"/g;
for (const match of allMigrationsSql.matchAll(dropTableRegex)) {
  allTableNames.delete(match[1]);
}

// Each table must have a CREATE TRIGGER <table>_notify_data_changed somewhere in the migrations.
const missing: Array<string> = [];
for (const table of allTableNames) {
  if (TABLES_WITHOUT_DATA_CHANGED_TRIGGER.has(table)) {
    continue;
  }
  const triggerName = `${table}_notify_data_changed`;
  if (!allMigrationsSql.includes(triggerName)) {
    missing.push(table);
  }
}

if (missing.length > 0) {
  console.error('');
  console.error('ERROR: The following tables are missing a data_changed notify trigger:');
  for (const table of missing.sort()) {
    console.error(`  - ${table}_notify_data_changed`);
  }
  console.error('');
  console.error(
    'Add a CREATE TRIGGER <table>_notify_data_changed in a migration file.',
  );
  console.error(
    'Use notify_data_changed_tenant() for tables with a direct tenant_id,',
  );
  console.error(
    'notify_data_changed_tenant_via_fk/2hop_fk() for FK-chained tables, or notify_data_changed_global() for truly global tables.',
  );
  console.error('See drizzle-schema.instructions.md for the convention.');
  process.exit(1);
}

console.log(`data_changed triggers OK (${allTableNames.size} tables checked).`);
