import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url));

const sources = (): Array<string> => readdirSync(MODULE_DIR, { withFileTypes: true, recursive: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
  .map((entry) => join(entry.parentPath, entry.name));

describe('the CRQ engine and the finding score', () => {
  // The engine must never read the finding score or the technique scores: they already carry the
  // controls it models itself. EPSS and the CISA listing reach it only as the threat stored in
  // `entry_openings`, a table of the neutral `entry-openings` module.
  it('should never reach the finding score module or its tables', () => {
    const offenders = sources()
      .filter((file) => /finding-score|findingScore|assetTechniqueScores|asset_technique_scores/i.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(MODULE_DIR.length));
    expect(offenders).toEqual([]);
  });
});
