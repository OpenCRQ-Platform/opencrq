/* eslint-disable no-console */
/**
 * Folds every migration of a ref into one `0000_baseline` in `src/db/migrations`, then checks the
 * result: a database built from it has the catalog of one built from the history, a database at
 * the ref adopts it without change, and a database behind the ref refuses it untouched.
 *
 * Needs this worktree's Postgres (`yarn env:up`), reached as `back/config/development(.local).json`
 * says, `PG*` variables first. It recreates the `squash_*` databases there and drops them on success.
 *
 * Usage: yarn db:squash [--ref <ref>] [--drizzle-v1 <version>]
 *   --ref         the history to fold, `origin/main` by default
 *   --drizzle-v1  also run `drizzle-kit up` and that Drizzle v1 release's migrate() on the adopted
 *                 database, installed in a temporary folder
 */
import type { ExecFileSyncOptions } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { z } from 'zod';
import * as schema from '../src/modules/schema';
import { IN_PLACE_UPDATE_FILLFACTOR, runMigration } from '../src/db/run-migrations';

/** Loose, so a journal written back keeps the fields drizzle-kit put there. */
const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ when: z.number(), tag: z.string() })) });
const configSchema = z.looseObject({ postgres: z.record(z.string(), z.unknown()).optional() });
const packageSchema = z.looseObject({ devDependencies: z.record(z.string(), z.string()) });

const readJson = <T>(file: string, shape: z.ZodType<T>): T => shape.parse(JSON.parse(readFileSync(file, 'utf8')));

const MODULE_ROOT = resolve(__dirname, '..');
const MIGRATIONS = join(MODULE_ROOT, 'src/db/migrations');
const BREAKPOINT = '\n--> statement-breakpoint\n';
const DATABASES = {
  history: 'squash_history',
  baseline: 'squash_baseline',
  atRef: 'squash_at_ref',
  behind: 'squash_behind',
  v1Adopted: 'squash_v1_adopted',
  v1Unadopted: 'squash_v1_unadopted',
};

const readPostgresConfig = (file: string): Record<string, unknown> => {
  const path = resolve(MODULE_ROOT, '../back/config', file);
  return existsSync(path) ? (readJson(path, configSchema).postgres ?? {}) : {};
};
const filePostgres = { ...readPostgresConfig('development.json'), ...readPostgresConfig('development.local.json') };
const connection = {
  host: process.env['PGHOST'] || String(filePostgres['host'] ?? 'localhost'),
  port: Number(process.env['PGPORT'] || filePostgres['port'] || 5432),
  user: process.env['PGUSER'] || String(filePostgres['user'] ?? 'app'),
  password: process.env['PGPASSWORD'] || String(filePostgres['password'] ?? 'admin'),
};

const withPool = async <T>(database: string, work: (pool: Pool) => Promise<T>): Promise<T> => {
  const pool = new Pool({ ...connection, database });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
};

const query = async <R extends object>(database: string, text: string): Promise<Array<R>> =>
  withPool(database, async (pool) => (await pool.query<R>(text)).rows);

const recreate = async (database: string, template?: string): Promise<void> => {
  await query('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await query('postgres', `CREATE DATABASE ${database}${template ? ` TEMPLATE ${template}` : ''}`);
};

const applyFolder = async (database: string, folder: string): Promise<void> =>
  withPool(database, (pool) => migrate(drizzle(pool), { migrationsFolder: folder }));

const runBranchMigration = async (database: string): Promise<void> =>
  withPool(database, (pool) => runMigration(drizzle(pool, { schema })));

const readJournal = (folder: string) => readJson(join(folder, 'meta/_journal.json'), journalSchema);

/** One line per object of schema `public`, independent of column order and object ids. */
const FINGERPRINT = `
  SELECT line FROM (
    SELECT 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
      || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
      || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
      || CASE WHEN a.attgenerated <> '' THEN ' generated' ELSE '' END
      || CASE WHEN a.attidentity <> '' THEN ' identity ' || a.attidentity::text ELSE '' END
      || CASE WHEN a.attcollation <> ty.typcollation THEN ' collate ' || a.attcollation::regcollation::text ELSE '' END AS line
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type ty ON ty.oid = a.atttypid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p') AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'relation ' || c.relname || ' kind ' || c.relkind::text || ' options ' || coalesce(array_to_string(c.reloptions, ','), '')
      || ' rls ' || c.relrowsecurity::text || ' persistence ' || c.relpersistence::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'S')
    UNION ALL
    SELECT 'constraint ' || c.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'index ' || pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'trigger ' || pg_get_triggerdef(t.oid) || ' enabled ' || t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'function ' || p.oid::regprocedure || ' ' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'type ' || t.typname || ' ' || coalesce((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid), '')
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
    UNION ALL
    SELECT 'view ' || c.relname || ' ' || md5(pg_get_viewdef(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    UNION ALL
    SELECT 'policy ' || tablename || '.' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'public'
    UNION ALL
    SELECT 'sequence ' || sequencename || ' ' || data_type || ' ' || start_value || ' ' || increment_by FROM pg_sequences WHERE schemaname = 'public'
    UNION ALL
    SELECT 'extension ' || extname FROM pg_extension
    UNION ALL
    SELECT 'schema ' || nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
    UNION ALL
    SELECT 'comment ' || c.relname || '.' || d.objsubid || ' ' || md5(d.description) FROM pg_description d
    JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  ) f ORDER BY line`;

/** The storage parameters `runMigration` sets, which `migrate()` alone does not. */
const RUN_MIGRATION_OPTIONS = new RegExp(`(autovacuum_analyze_threshold=0|fillfactor=${IN_PLACE_UPDATE_FILLFACTOR}),?`, 'g');

const fingerprint = async (database: string): Promise<Array<string>> =>
  (await query<{ line: string }>(database, FINGERPRINT)).map(({ line }) => line.replace(RUN_MIGRATION_OPTIONS, ''));

const ledger = async (database: string): Promise<Array<number>> =>
  (await query<{ created_at: string }>(database, 'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at'))
    .map((row) => Number(row.created_at));

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Drizzle's own message only says a query failed; the Postgres error is its cause. */
const reason = (error: unknown): string => {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return cause instanceof Error ? cause.message : String(cause);
};

const fail = (message: string, lines: Array<string> = []): never => {
  console.error(`FAIL ${message}`);
  lines.forEach((line) => console.error(`  ${line}`));
  process.exit(1);
};

const commandFailureSchema = z.object({ stdout: z.string(), stderr: z.string() });

/** Runs a command with its output captured: undefined when it succeeds, its output when it fails. */
const runCommand = (command: string, args: Array<string>, options: ExecFileSyncOptions = {}): string | undefined => {
  try {
    execFileSync(command, args, { ...options, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 26 });
    return undefined;
  } catch (error) {
    const output = commandFailureSchema.safeParse(error);
    return output.success ? `${output.data.stdout}${output.data.stderr}` : reason(error);
  }
};

const mustRunCommand = (command: string, args: Array<string>, options: ExecFileSyncOptions = {}): void => {
  const failure = runCommand(command, args, options);
  if (failure !== undefined) {
    fail(`${command} ${args.join(' ')} failed`, failure.trimEnd().split('\n'));
  }
};

/**
 * The SQL drizzle-kit never writes, read from a database built from the history with an empty
 * `search_path`, so every name comes out schema-qualified as the baseline must state it. The
 * functions an extension installs come with it and are left out.
 */
const readHandWritten = async (database: string) => withPool(database, async (pool) => {
  const client = await pool.connect();
  try {
    await client.query('SET search_path = \'\'');
    const extensions = await client.query<{ statement: string }>(`
      SELECT format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', e.extname, n.nspname) AS statement
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname <> 'plpgsql' ORDER BY e.extname`);
    const functions = await client.query<{ name: string, statement: string }>(`
      SELECT p.proname AS name, rtrim(pg_get_functiondef(p.oid), E'\\n') || ';' AS statement
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      ORDER BY p.oid::regprocedure::text`);
    const triggers = await client.query<{ statement: string }>(`
      SELECT pg_get_triggerdef(t.oid) || ';' AS statement
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`);
    return { extensions: extensions.rows, functions: functions.rows, triggers: triggers.rows };
  } finally {
    client.release();
  }
});

const main = async (): Promise<void> => {
  const { values: options } = parseArgs({ options: { 'ref': { type: 'string', default: 'origin/main' }, 'drizzle-v1': { type: 'string' } } });
  const uncommitted = execFileSync('git', ['status', '--porcelain', '--', 'src/db/migrations'], { cwd: MODULE_ROOT, encoding: 'utf8' }).trimEnd();
  if (uncommitted) {
    fail('src/db/migrations has uncommitted changes, which the squash would delete; commit or discard them first', uncommitted.split('\n'));
  }
  const scratch = mkdtempSync(join(tmpdir(), 'squash-migrations-'));

  console.log(`== Fold the history of ${options.ref}`);
  const archive = execFileSync('git', ['archive', options.ref, 'src/db/migrations'], { cwd: MODULE_ROOT, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', scratch], { input: archive });
  const history = join(scratch, 'src/db/migrations');
  const historyJournal = readJournal(history);
  const last = historyJournal.entries.at(-1) ?? fail('the history holds no migration');
  console.log(`${historyJournal.entries.length} migrations, the last one ${last.tag}`);
  await recreate(DATABASES.history);
  await applyFolder(DATABASES.history, history);
  const handWritten = await readHandWritten(DATABASES.history);

  rmSync(MIGRATIONS, { recursive: true, force: true });
  mkdirSync(MIGRATIONS, { recursive: true });
  mustRunCommand('yarn', ['drizzle-kit', 'generate', '--name', 'baseline'], { cwd: MODULE_ROOT });
  const baselineFile = join(MIGRATIONS, '0000_baseline.sql');
  const generated = readFileSync(baselineFile, 'utf8').trimEnd();

  // A generated column, a default or an index expression calls its function as the table is
  // created, so those functions come first; the others may take a table's row type, so they come after.
  const called = new Set([...generated.matchAll(/([\w$]+)\s*\(/g)].map(([, name]) => name));
  const calledByGenerated = handWritten.functions.filter(({ name }) => called.has(name));
  const prologue = [...handWritten.extensions, ...calledByGenerated].map(({ statement }) => statement);
  const epilogue = [...handWritten.functions.filter((fn) => !calledByGenerated.includes(fn)), ...handWritten.triggers].map(({ statement }) => statement);
  writeFileSync(baselineFile, `${[
    ...(prologue.length ? [`-- Hand-written: the extensions, and the functions the generated statements call. drizzle-kit generates neither.\n${prologue.join(BREAKPOINT)}`] : []),
    generated,
    `-- Hand-written from here on: drizzle-kit generates no function and no trigger.\n${epilogue.join(BREAKPOINT)}`,
  ].join(BREAKPOINT)}\n`);

  // drizzle v0 runs a migration only when it is newer than the last one a database recorded: a
  // database at the ref then skips the baseline, and one behind it fails on its first CREATE.
  const journal = readJournal(MIGRATIONS);
  journal.entries[0].when = last.when;
  writeFileSync(join(MIGRATIONS, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`baseline: ${prologue.length} statements before the tables, ${epilogue.length} after, when ${last.when}`);

  console.log('== A database built from the baseline matches one built from the history');
  await recreate(DATABASES.baseline);
  await applyFolder(DATABASES.baseline, MIGRATIONS);
  const expected = await fingerprint(DATABASES.history);
  const actual = await fingerprint(DATABASES.baseline);
  if (!same(expected, actual)) {
    fail('the catalogs differ', [
      ...expected.filter((line) => !actual.includes(line)).map((line) => `- ${line}`),
      ...actual.filter((line) => !expected.includes(line)).map((line) => `+ ${line}`),
    ]);
  }
  console.log(`${expected.length} catalog lines identical`);

  console.log(`== A database at ${options.ref} adopts it unchanged`);
  await recreate(DATABASES.atRef, DATABASES.history);
  for (const run of ['first', 'second']) {
    await runBranchMigration(DATABASES.atRef).catch((error: unknown) => fail(`the ${run} run refused a database at ${options.ref}: ${reason(error)}`));
    if (!same(await ledger(DATABASES.atRef), [last.when])) {
      fail(`the ${run} run leaves the ledger at ${JSON.stringify(await ledger(DATABASES.atRef))}, not the baseline's row alone`);
    }
    if (!same(await fingerprint(DATABASES.atRef), expected)) {
      fail(`the ${run} run changed the schema`);
    }
  }
  console.log(`${historyJournal.entries.length} ledger rows down to 1, schema unchanged, a second run changes nothing`);

  console.log(`== A database behind ${options.ref} refuses it untouched`);
  const behind = join(scratch, 'behind');
  cpSync(history, behind, { recursive: true });
  const behindJournal = readJournal(behind);
  behindJournal.entries.pop();
  writeFileSync(join(behind, 'meta/_journal.json'), JSON.stringify(behindJournal));
  await recreate(DATABASES.behind);
  await applyFolder(DATABASES.behind, behind);
  const behindBefore = { ledger: await ledger(DATABASES.behind), catalog: await fingerprint(DATABASES.behind) };
  const refusal = await runBranchMigration(DATABASES.behind).then(() => fail(`a database without ${last.tag} accepted the baseline`), reason);
  const behindAfter = { ledger: await ledger(DATABASES.behind), catalog: await fingerprint(DATABASES.behind) };
  // Only the baseline's first CREATE meeting what the database already holds proves the refusal.
  if (!refusal.includes('already exists')) {
    fail(`a database without ${last.tag} failed for another reason: ${refusal}`);
  }
  if (!same(behindBefore, behindAfter)) {
    fail('the refused run changed the database');
  }
  console.log(`without ${last.tag}: refused, ledger and schema unchanged`);

  const v1 = options['drizzle-v1'];
  if (v1) {
    console.log(`== Drizzle ${v1} upgrades the folder and the adopted database`);
    const v1Dir = join(scratch, 'drizzle-v1');
    mkdirSync(v1Dir);
    const pgVersion = readJson(join(MODULE_ROOT, 'package.json'), packageSchema).devDependencies['pg'];
    mustRunCommand('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', `drizzle-orm@${v1}`, `drizzle-kit@${v1}`, `pg@${pgVersion}`], { cwd: v1Dir });
    cpSync(MIGRATIONS, join(v1Dir, 'migrations'), { recursive: true });
    mustRunCommand('npx', ['drizzle-kit', 'up', '--dialect', 'postgresql', '--out', './migrations'], { cwd: v1Dir });
    writeFileSync(join(v1Dir, 'migrate.mjs'), `
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
const pool = new pg.Pool({ database: process.argv[2] });
try { await migrate(drizzle({ client: pool }), { migrationsFolder: './migrations' }); } finally { await pool.end(); }
`);
    const v1Migrate = (database: string): string | undefined => runCommand('node', ['migrate.mjs', database], {
      cwd: v1Dir,
      env: { ...process.env, PGHOST: connection.host, PGPORT: String(connection.port), PGUSER: connection.user, PGPASSWORD: connection.password },
    });
    await recreate(DATABASES.v1Adopted, DATABASES.atRef);
    const adoption = v1Migrate(DATABASES.v1Adopted);
    if (adoption !== undefined) {
      fail(`Drizzle ${v1} refused the adopted database`, adoption.trimEnd().split('\n'));
    }
    if (!same(await ledger(DATABASES.v1Adopted), [last.when]) || !same(await fingerprint(DATABASES.v1Adopted), expected)) {
      fail(`Drizzle ${v1} changed the adopted database`);
    }
    // Without runMigration's cleanup, v1 meets rows no migration folder matches and refuses to start.
    await recreate(DATABASES.v1Unadopted, DATABASES.history);
    const unadopted = v1Migrate(DATABASES.v1Unadopted) ?? fail(`Drizzle ${v1} accepted a database whose folded rows were never cleaned up`);
    if (!unadopted.includes('do not match any local migration')) {
      fail(`Drizzle ${v1} refused a database whose folded rows were never cleaned up, for another reason`, unadopted.trimEnd().split('\n'));
    }
    console.log('the adopted database migrates with nothing applied; one never cleaned up is refused');
  }

  for (const database of Object.values(DATABASES)) {
    await query('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  }
  rmSync(scratch, { recursive: true, force: true });
  console.log('OK the baseline replaces the history');
};

void main().catch((error: unknown) => fail(reason(error)));
