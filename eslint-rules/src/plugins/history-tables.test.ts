import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { historyTables } from './history-tables';

const MODULES = path.resolve(import.meta.dirname, '../../../module/src/modules');

const exportedTables = (): Set<string> => {
  const names = new Set<string>();
  for (const file of fs.readdirSync(MODULES, { recursive: true, encoding: 'utf8' })) {
    if (path.basename(file) === 'schema.ts') {
      for (const [, name] of fs.readFileSync(path.join(MODULES, file), 'utf8').matchAll(/export const (\w+) = pgTable\(/g)) {
        names.add(name);
      }
    }
  }
  return names;
};

describe('historyTables', () => {
  // A name the schema no longer exports would leave its table out of the rule without a word.
  it('names tables the schema exports', () => {
    const tables = exportedTables();
    expect(historyTables.filter((name) => !tables.has(name))).toEqual([]);
  });

  it('lists every table named a history', () => {
    expect([...exportedTables()].filter((name) => name.endsWith('History') && !historyTables.includes(name))).toEqual([]);
  });
});
