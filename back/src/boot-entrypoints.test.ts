import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Split-boot regression guard: the threat-bundle upload route must only run
// in the HTTP process and its job handler must only run in the worker process. Mixing them up
// again (e.g. re-adding the uploader to index-worker, or the parser to index-http) would
// silently break split-boot deployments.
const here = dirname(fileURLToPath(import.meta.url));

/** Returns the module specifiers of every static `import` declaration in a TS file. */
const getStaticImportSpecifiers = (filePath: string): Array<string> => {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const specifiers: Array<string> = [];

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
  });

  return specifiers;
};

describe('boot entrypoints wire the intrusion-set uploader/parser to the right process', () => {
  it('index-http.ts imports the uploader but not the parser', () => {
    const imports = getStaticImportSpecifiers(join(here, 'index-http.ts'));
    expect(imports).toContain('./features/threat-uploader');
    expect(imports).not.toContain('./features/threat-parser');
  });

  it('index-worker.ts imports the parser but not the uploader', () => {
    const imports = getStaticImportSpecifiers(join(here, 'index-worker.ts'));
    expect(imports).toContain('./features/threat-parser');
    expect(imports).not.toContain('./features/threat-uploader');
  });

  it('index.ts (non-split boot) imports both', () => {
    const imports = getStaticImportSpecifiers(join(here, 'index.ts'));
    expect(imports).toContain('./features/threat-uploader');
    expect(imports).toContain('./features/threat-parser');
  });
});

describe('boot entrypoints wire the opencti connector to the worker only', () => {
  it('index-worker.ts imports opencti', () => {
    const imports = getStaticImportSpecifiers(join(here, 'index-worker.ts'));
    expect(imports).toContain('./features/opencti');
  });

  it('index.ts (non-split boot) imports opencti', () => {
    const imports = getStaticImportSpecifiers(join(here, 'index.ts'));
    expect(imports).toContain('./features/opencti');
  });

  it('index-http.ts does not import opencti (no HTTP surface — a persistent SSE connector runs in the worker only)', () => {
    const imports = getStaticImportSpecifiers(join(here, 'index-http.ts'));
    expect(imports).not.toContain('./features/opencti');
  });
});

describe('boot entrypoints keep the recompute trigger paths in the job-running processes', () => {
  it('index-http.ts imports neither the finding-score feature nor the recompute dispatcher', () => {
    const imports = getStaticImportSpecifiers(join(here, 'index-http.ts'));
    expect(imports).not.toContain('./features/finding-score');
    expect(imports).not.toContain('./features/recompute-dispatcher');
  });

  it('index-worker.ts and index.ts import both', () => {
    for (const entrypoint of ['index-worker.ts', 'index.ts']) {
      const imports = getStaticImportSpecifiers(join(here, entrypoint));
      expect(imports).toContain('./features/finding-score');
      expect(imports).toContain('./features/recompute-dispatcher');
    }
  });
});
