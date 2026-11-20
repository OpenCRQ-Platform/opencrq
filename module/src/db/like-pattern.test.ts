import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './like-pattern';

describe('escapeLikePattern', () => {
  it('escapes the escape character itself, so a domain account name stays literal', () => {
    expect(escapeLikePattern('acme-ws-114\\localadmin')).toBe('acme-ws-114\\\\localadmin');
  });

  it('escapes both wildcards', () => {
    expect(escapeLikePattern('sql_svc 100%')).toBe('sql\\_svc 100\\%');
  });

  it('leaves a term with none of them untouched', () => {
    expect(escapeLikePattern('Nadia Fournier')).toBe('Nadia Fournier');
  });
});
