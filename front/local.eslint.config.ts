/* eslint-disable */
import type { ESLint } from 'eslint';
import pluginLingui from 'eslint-plugin-lingui';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { linguiRules, localeFormattingSelectors, queryInvalidationSelectors, routeSearchSchemaImportSelectors } from 'eslint-rules/src/rules';
import { defineConfig } from 'eslint/config';

// A flat-config `rules` object replaces a same-named rule wholesale where two `files` blocks both
// match a file — it does not merge their `no-restricted-syntax` arrays. The `src/routes/**` block
// below needs its own extra selector on top of this one, so both spread from this shared list
// instead of the routes block silently losing everything defined here.
const restrictedSyntaxRules = [
  {
    selector: 'TSQualifiedName[left.name="React"][right.name="ReactNode"]',
    message: 'Prefer `ReactNode` over `React.ReactNode`. Import `ReactNode` directly from "react" if necessary (e.g., `import type { ReactNode } from "react";`).',
  },
  {
    selector: 'CallExpression[callee.name="useMemo"]',
    message: 'Prefer React Compiler automatic memoization instead of useMemo.',
  },
  {
    selector: 'CallExpression[callee.name="useCallback"]',
    message: 'Prefer React Compiler automatic memoization instead of useCallback.',
  },
  {
    selector: 'CallExpression[callee.name="memo"]',
    message: 'Prefer React Compiler automatic memoization instead of memo.',
  },
  {
    selector: 'LogicalExpression[operator="??"] > Literal[value="-"], LogicalExpression[operator="||"] > Literal[value="-"], LogicalExpression[operator="??"] > Literal[value="—"], LogicalExpression[operator="||"] > Literal[value="—"]',
    message: 'Use `EMPTY_VALUE` from utils/empty-value (or `<EmptyValue />` from components/ui/empty-value in JSX) instead of a raw dash fallback.',
  },
  {
    selector: 'ConditionalExpression > Literal[value="-"], ConditionalExpression > Literal[value="—"]',
    message: 'Use `EMPTY_VALUE` (or `<EmptyValue />` in JSX) from components/ui/empty-value instead of a raw dash fallback.',
  },
  {
    selector: 'ReturnStatement > Literal[value="-"], ReturnStatement > Literal[value="—"]',
    message: 'Use `EMPTY_VALUE` (or `<EmptyValue />` in JSX) from components/ui/empty-value instead of a raw dash fallback.',
  },
  {
    selector: 'JSXText[value="-"], JSXText[value="—"]',
    message: 'Use `<EmptyValue />` from components/ui/empty-value instead of a raw dash placeholder.',
  },
  ...queryInvalidationSelectors,
  ...localeFormattingSelectors,
];

export default defineConfig([
  // Its preset names no files, and the React Compiler rules crash on the JSON the root config lints.
  { ...reactHooks.configs.flat['recommended-latest'], files: ['**/*.{js,mjs,cjs,ts,tsx}'] },
  {
    files: ['**/*.{js,ts,tsx}'],
    plugins: { react, lingui: pluginLingui as unknown as ESLint.Plugin },
    rules: {
      ...linguiRules,
      /** Enforce consistent indentation in JSX */
      'react/jsx-indent': ['error', 2],
      /** Enforce the use of double quotes for JSX attributes */
      'jsx-quotes': ['error', 'prefer-double'],
      /** Verify the list of dependencies for Hooks like useEffect */
      'react-hooks/exhaustive-deps': 'error',
      /** Disallow fully qualified React.ReactNode type usage + prefer React Compiler over manual memoization */
      'no-restricted-syntax': ['error', ...restrictedSyntaxRules],
      /** Disallow unnecessary curly braces in JSX props and children */
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      /** When a JSX element spans multiple lines, put first prop on its own line */
      '@stylistic/jsx-first-prop-new-line': ['error', 'multiline-multiprop'],
      /** Allow at most 1 prop per line when the opening tag is multiline */
      '@stylistic/jsx-max-props-per-line': ['error', { maximum: 1, when: 'multiline' }],
    },
  },
  {
    files: ['tailwind.config.ts'],
    rules: {
      /** Allow CommonJS syntax (require/module.exports) for Tailwind configuration */
      'import/no-commonjs': 'off',
    },
  },
  {
    files: ['src/routes/**/*.{ts,tsx}'],
    rules: {
      'check-file/filename-naming-convention': 'off',
      'check-file/folder-naming-convention': 'off',
      'no-restricted-syntax': ['error', ...restrictedSyntaxRules, ...routeSearchSchemaImportSelectors],
    },
  },
  {
    files: ['scripts/**'],
    rules: {
      'lingui/no-unlocalized-strings': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'lingui/no-unlocalized-strings': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/components/shared/form-drawer.tsx',
      'src/components/shared/display-drawer.tsx',
      'src/components/shared/drawer-content.tsx',
      'src/components/shared/drawer-form-header.tsx',
      'src/components/shared/drawer-form-footer.tsx',
    ],
    rules: {
      /** Enforce usage of generic drawer wrappers instead of raw @filigran/ui Sheet primitives */
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@filigran/ui',
          importNames: ['Sheet', 'SheetContent', 'SheetTrigger', 'SheetHeader', 'SheetTitle', 'SheetFooter'],
          message: 'Use FormDrawer, DisplayDrawer, or EditEntityDrawer from components/shared instead of raw Sheet primitives. If you need a new drawer variant, create it in components/shared/.',
        }, {
          name: '@filigran/ui',
          importNames: ['DatePicker'],
          message: 'Its dates, placeholder and calendar stay in English whatever the application language is, since it formats with no locale. Use DateFormInput from components/shared.',
        }],
      }],
    },
  },
]);
