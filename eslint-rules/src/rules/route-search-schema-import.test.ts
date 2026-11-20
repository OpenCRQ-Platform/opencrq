import { Linter } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { routeSearchSchemaImportSelectors } from './route-search-schema-import';

const lint = (code: string) => new Linter().verify(code, {
  languageOptions: { parser: typescriptEslint.parser, sourceType: 'module' },
  rules: { 'no-restricted-syntax': ['error', ...routeSearchSchemaImportSelectors] },
});

describe('routeSearchSchemaImportSelectors', () => {
  it('flags a search schema imported from the features barrel', () => {
    expect(lint("import { fooListSearchSchema } from '../../../../../features';")).toHaveLength(1);
  });

  it('flags search defaults imported from the features barrel', () => {
    expect(lint("import { FOO_LIST_SEARCH_DEFAULTS } from '../../../../../features';")).toHaveLength(1);
  });

  it('flags both when imported together from the barrel', () => {
    expect(lint("import { FOO_LIST_SEARCH_DEFAULTS, fooListSearchSchema } from '../../../../../features';")).toHaveLength(2);
  });

  it('flags the barrel import even when the specifier is renamed locally', () => {
    expect(lint("import { fooListSearchSchema as schema } from '../../../../../features';")).toHaveLength(1);
  });

  it('flags a schema imported from a feature-level barrel, which cycles just the same', () => {
    expect(lint("import { fooListSearchSchema } from '../../../../../features/foo';")).toHaveLength(1);
  });

  it('flags a schema imported from a nested feature barrel', () => {
    expect(lint("import { fooListSearchSchema } from '../../../../../features/controls/capability';")).toHaveLength(1);
  });

  it('lets the same schema import through from its own module', () => {
    expect(lint("import { fooListSearchSchema } from '../../../../../features/foo/foo-list-search';")).toHaveLength(0);
  });

  it('lets a schema import through from a nested own module', () => {
    expect(lint("import { capabilitiesListSearchSchema } from '../../../features/controls/capability/capabilities-list-search';")).toHaveLength(0);
  });

  it('lets a component import from the barrel through — only the schema/defaults naming is restricted', () => {
    expect(lint("import { FooDataTable } from '../../../../../features';")).toHaveLength(0);
  });

  it('lets an unrelated named import from the barrel through', () => {
    expect(lint("import { someHelper } from '../../../../../features';")).toHaveLength(0);
  });
});
