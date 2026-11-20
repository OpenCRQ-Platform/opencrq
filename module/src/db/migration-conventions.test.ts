import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const FUNCTION_DECLARATION = /create\s+(?:or\s+replace\s+)?function\b/gi;

/** A function up to and including its body, whatever its dollar-quote tag: its name, what it returns, the attributes between, and the body. */
const FUNCTION_PATTERN = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\((?:[^()]|\([^)]*\))*\)\s*returns\s+(\w+)([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;

const functionsOf = (sql: string) => [...sql.matchAll(FUNCTION_PATTERN)].map((match) => ({
  name: match[1],
  returns: match[2].toLowerCase(),
  isImmutable: /\bimmutable\b/i.test(match[3]),
  body: match[5],
}));

const migrationSql = () => readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));

/** Postgres takes `IMMUTABLE` on trust, so the body is what has to show the function reads no table. Only `unnest` is allowed a `FROM`. */
const readsATable = (body: string) => {
  const code = body.replace(/--.*$/gm, '');
  return /\bexecute\b/i.test(code) || /(?<!distinct\s)\b(?:from|join)\s+(?!unnest\s*\()/i.test(code);
};

const migrationFunctions = () => migrationSql()
  .flatMap(({ name, sql }) => functionsOf(sql).map((fn) => ({ ...fn, name: `${name}: ${fn.name}` })));

describe('migration conventions', () => {
  it('should parse every function a migration declares', () => {
    const unparsed = migrationSql()
      .filter(({ sql }) => functionsOf(sql).length !== [...sql.matchAll(FUNCTION_DECLARATION)].length)
      .map(({ name }) => name);

    expect(unparsed, 'A declaration the pattern cannot parse escapes both checks below, which then pass on nothing.').toEqual([]);
  });

  it('should declare every migration function as a trigger function or an immutable one', () => {
    const offenders = migrationFunctions()
      .filter((fn) => fn.returns !== 'trigger' && !fn.isImmutable)
      .map((fn) => `${fn.name} returns ${fn.returns}`);

    expect(
      offenders,
      'Read observation is EXPLAIN of the statements the application emits, and a plan does not name the tables a function body reads. A function called from an application query would silently narrow the observed read set, so only trigger functions and functions declared IMMUTABLE, which read no table, may live in a migration.',
    ).toEqual([]);
  });

  it('should keep an immutable function from reading a table or running dynamic SQL', () => {
    const offenders = migrationFunctions()
      .filter((fn) => fn.returns !== 'trigger' && fn.isImmutable && readsATable(fn.body))
      .map((fn) => fn.name);

    expect(
      offenders,
      'A function labelled IMMUTABLE is not checked by Postgres: one that reads a table would hide that read from the observed read set exactly as a plain function does.',
    ).toEqual([]);
  });

  describe('a function body that reads', () => {
    it.each([
      ['a table', 'SELECT count(*) FROM asset_evidence'],
      ['a joined table', 'SELECT 1 FROM unnest(history) h JOIN asset_evidence e ON e.id = h.id'],
      ['dynamic SQL', 'EXECUTE format(\'select %s\', 1)'],
    ])('should be refused: %s', (_label, body) => {
      expect(readsATable(body)).toBe(true);
    });

    it.each([
      ['its arguments through unnest', 'FOR r IN SELECT h.* FROM unnest(history) h LOOP END LOOP'],
      ['a comparison that says "distinct from"', 'RETURN a IS DISTINCT FROM b'],
      ['a comment that says "from"', '-- reads from nothing\nSELECT greatest(a, b)'],
    ])('should pass: %s', (_label, body) => {
      expect(readsATable(body)).toBe(false);
    });
  });
});
