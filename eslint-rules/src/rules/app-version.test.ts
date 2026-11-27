import { Linter } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { appVersionRules } from './app-version';

const lint = (code: string) => new Linter().verify(code, {
  languageOptions: { parser: typescriptEslint.parser },
  rules: appVersionRules,
});

describe('appVersionRules', () => {
  it('flags a read of APP_VERSION, whatever its spelling', () => {
    expect(lint('const version = process.env.APP_VERSION;')).toHaveLength(1);
    expect(lint('const version = process.env[\'APP_VERSION\'];')).toHaveLength(1);
    expect(lint('const { APP_VERSION } = process.env;')).toHaveLength(1);
    expect(lint('const { env: { APP_VERSION: version } } = process;')).toHaveLength(1);
  });

  it('flags a read of APP_COMMIT_TIME, whatever its spelling', () => {
    expect(lint('const time = process.env.APP_COMMIT_TIME;')).toHaveLength(1);
    expect(lint('const { APP_COMMIT_TIME } = process.env;')).toHaveLength(1);
  });

  it('leaves other variables alone', () => {
    expect(lint('const id = process.env.BOOT_ID;')).toHaveLength(0);
  });
});
