import { Linter } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { queryInvalidationSelectors } from './query-invalidation';

const lint = (code: string) => new Linter().verify(code, {
  languageOptions: { parser: typescriptEslint.parser },
  rules: { 'no-restricted-syntax': ['error', ...queryInvalidationSelectors] },
});

describe('queryInvalidationSelectors', () => {
  it('lets router.invalidate() through — the TanStack Router loader cache is a different mechanism', () => {
    expect(lint('async function f() { await router.invalidate(); }')).toHaveLength(0);
  });

  it('flags queryClient.invalidateQueries()', () => {
    expect(lint('void queryClient.invalidateQueries(x);')).toHaveLength(1);
  });

  it('flags the refetchQueries and resetQueries ways around invalidateQueries', () => {
    expect(lint('queryClient.refetchQueries(x);')).toHaveLength(1);
    expect(lint('queryClient.resetQueries(x);')).toHaveLength(1);
  });

  it('lets a form or a navigation blocker reset itself', () => {
    expect(lint('form.reset();')).toHaveLength(0);
    expect(lint('blocker.reset();')).toHaveLength(0);
  });

  it('lets a query refetch on demand — a retry button is not cache invalidation', () => {
    expect(lint('const { refetch } = useQuery(); refetch();')).toHaveLength(0);
  });
});
