import { RuleTester } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noUnguardedReachabilityWrite } from './no-unguarded-reachability-write';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

describe('noUnguardedReachabilityWrite', () => {
  it('flags a guarded repo call made outside keepingPlatformReachable', () => {
    ruleTester.run('no-unguarded-reachability-write', noUnguardedReachabilityWrite, {
      valid: [],
      invalid: [
        {
          code: 'const service = { deletePlatformRole: async ({ repo }, id) => await repo.guardedDeletePlatformRole(id) };',
          errors: [{ messageId: 'requiresGuard' }],
        },
        {
          code: 'const cleanup = () => repo.guardedDeleteUser(id);',
          errors: [{ messageId: 'requiresGuard' }],
        },
      ],
    });
  });

  it('does not flag a guarded repo call wrapped in keepingPlatformReachable', () => {
    ruleTester.run('no-unguarded-reachability-write', noUnguardedReachabilityWrite, {
      valid: [
        {
          code: 'const service = { deletePlatformRole: async ({ atomic }, id) => await atomic(async ({ repo, deps }) => '
            + 'await deps.platformCapabilities.keepingPlatformReachable(() => repo.guardedDeletePlatformRole(id))) };',
        },
      ],
      invalid: [],
    });
  });

  it('does not flag an unrelated or non-guarded repo call', () => {
    ruleTester.run('no-unguarded-reachability-write', noUnguardedReachabilityWrite, {
      valid: [
        { code: 'repo.deletePlatformRole(id)' },
        { code: 'repo.findAllPlatformRoles()' },
        { code: 'notRepo.guardedDeletePlatformRole(id)' },
      ],
      invalid: [],
    });
  });
});
