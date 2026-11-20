import json from '@eslint/json';
import stylistic from '@stylistic/eslint-plugin';
import checkFile from 'eslint-plugin-check-file';
import importPlugin from 'eslint-plugin-import-x';
import nodePlugin from 'eslint-plugin-n';
import sort from 'eslint-plugin-sort';
import { appVersionRules, drizzleSchemaRules, fileFormat, importRules, javascriptOnlyRules, javascriptRules, localeFormattingSelectors, nodeRules, noRawErrorRules, repositorySecurityRules, securityPolicyRules, stylisticRules, typescriptRules } from 'eslint-rules/src/rules';
import { appPlugin, historyTables } from 'eslint-rules/src/plugins';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import typescriptEslint from 'typescript-eslint';
import packageJson from './package.json' with { type: 'json' };

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default (async () => {
  const workspaces: Array<string> = packageJson.workspaces;

  const localEslintConfig = (
    await Promise.all(workspaces.map(async (workspace) => {
      const workspaceEslintConfigsPath = path.resolve(dirname, workspace, 'local.eslint.config.ts');
      if (fs.existsSync(workspaceEslintConfigsPath)) {
        try {
          const workspaceEslintConfigs = await import(workspaceEslintConfigsPath);
          return {
            basePath: `${workspace}/`,
            extends: [workspaceEslintConfigs.default],
          };
        } catch (e) {
          throw new Error(`Workspace local eslint config format is not supported. Check ${workspaceEslintConfigsPath}`, { cause: e });
        }
      }
      return null;
    }))
  ).filter((config) => config !== null);

  return defineConfig([
    // `.cursor/` and `.claude/worktrees/` hold local agent worktrees, each a
    // full copy of the repo, and must never be linted.
    { ignores: ['**/dist/', '**/build/', '**/node_modules', '**/.cursor/', '**/.claude/worktrees/'] },
    {
      files: ['**/*.d.ts'],
      plugins: { 'check-file': checkFile },
      rules: {
        'check-file/filename-blocklist': [
          'error',
          { '**/*.d.ts': 'The use of `.d.ts` files is forbidden. Please use `.ts` files instead.' },
        ],
      },
    },
    {
      files: [
        '**/*.{js,mjs,cjs,ts,tsx}',
      ],
      languageOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
        parser: typescriptEslint.parser,
        globals: {
          ...globals.browser,
        },
      },
      plugins: {
        'check-file': checkFile,
        '@stylistic': stylistic,
        '@typescript-eslint': typescriptEslint.plugin,
        sort,
        import: importPlugin,
        node: nodePlugin,
      },
      settings: {
        'import-x/internal-regex': '^@/',
      },
      rules: {
        ...javascriptRules,
        ...importRules,
        ...nodeRules,
        ...stylisticRules,
        ...fileFormat,
      },
    },
    {
      files: [
        '**/*.{js,mjs,cjs}',
      ],
      rules: {
        ...javascriptOnlyRules,
      },
    },
    {
      files: [
        '**/*.{ts,tsx}',
      ],
      languageOptions: {
        parserOptions: {
          project: true,
        },
      },
      rules: {
        ...typescriptRules,
      },
    },
    {
      files: ['**/*.{ts,tsx}'],
      ignores: ['**/*.config.ts'],
      rules: { 'import/no-default-export': 'error' },
    },
    {
      files: ['**/esbuild-plugins/**'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['.github/**/scripts/**', 'scripts/xtm-one-contract.mjs'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['module/src/security/**/*.ts'],
      rules: securityPolicyRules,
    },
    {
      files: ['module/src/modules/**/*.ts', 'back/src/features/**/*.ts'],
      ignores: [
        'module/src/modules/**/*.test.ts',
        'module/src/modules/mitre-attack/scripts/**',
        'back/src/features/**/*.test.ts',
      ],
      plugins: { app: appPlugin },
      rules: noRawErrorRules,
    },
    {
      files: ['module/src/**/*.ts'],
      ignores: ['module/src/**/*.test.ts'],
      plugins: { app: appPlugin },
      rules: {
        'app/no-distinct-on-subquery': ['error', { historyTables }],
      },
    },
    {
      files: ['module/src/**/schema.ts'],
      plugins: { app: appPlugin },
      rules: {
        'app/no-implicit-index-nulls-order': 'error',
      },
    },
    {
      files: ['module/src/modules/**/repository.ts'],
      plugins: { app: appPlugin },
      rules: {
        'app/no-unguarded-rewrite': 'error',
      },
    },
    {
      files: ['module/src/modules/**/repository.ts'],
      ignores: [
        'module/src/modules/auth/**',
      ],
      rules: repositorySecurityRules,
    },
    {
      files: ['module/src/modules/**/repository.ts'],
      ignores: [
        'module/src/modules/auth/**',
      ],
      plugins: { app: appPlugin },
      rules: {
        'app/no-raw-table-in-reads': ['error', {
          globalTables: [
            'capabilities',
            'groupUsers', 'groupRoles', 'roleCapabilities',
            'mitreTechniques',
            'controlCapabilities',
            'controlCapabilityEdges',
            'controlCapabilityStrengthRungLabels',
            'controlCapabilityCrosswalk',
          ],
        }],
        'app/no-unused-repo-method': 'error',
      },
    },
    {
      files: ['module/src/modules/**/service.ts'],
      plugins: { app: appPlugin },
      rules: {
        'app/no-unused-service-method': 'error',
        'app/no-unguarded-reachability-write': 'error',
      },
    },
    {
      files: ['back/src/features/**/*-router.ts'],
      ignores: [
        'back/src/features/app-router/app-router-router.ts',
      ],
      plugins: { app: appPlugin },
      rules: {
        'app/no-unused-router-endpoint': 'error',
        'app/no-optional-query-output': 'error',
        'app/no-unbounded-list-query': 'error',
        'app/no-full-row-list-output': 'error',
      },
    },
    {
      files: ['module/src/modules/**/schema.ts'],
      rules: drizzleSchemaRules,
    },
    {
      // `utils` feeds `front`, where a figure printed with no locale reads in the browser's language.
      files: ['utils/src/**/*.ts'],
      rules: { 'no-restricted-syntax': ['error', ...localeFormattingSelectors] },
    },
    {
      files: ['**/*.{ts,tsx}'],
      ignores: ['back/src/utils/platform-version.ts', '**/*.test.ts'],
      rules: appVersionRules,
    },
    // The configuration files written by hand: their readers keep the last of two equal keys and drop
    // the first without a word, and neither tsc, Yarn, nconf, Renovate nor jq says so. Generated and
    // data files stay out.
    {
      files: ['renovate.json5', '**/tsconfig*.json', '**/package.json', 'back/config/*.json', 'knip.json', '.claude/settings.json', '.github/sbom-manufacturer.json'],
      language: 'json/json',
      plugins: { json },
      rules: { 'json/no-duplicate-keys': 'error' },
    },
    {
      files: ['renovate.json5'],
      language: 'json/json5',
    },
    {
      // TypeScript reads its configuration as JSON with comments and trailing commas.
      files: ['**/tsconfig*.json'],
      language: 'json/jsonc',
      languageOptions: { allowTrailingCommas: true },
    },
    ...localEslintConfig,
  ]);
})();
