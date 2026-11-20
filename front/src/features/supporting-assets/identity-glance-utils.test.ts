import { describe, expect, it } from 'vitest';
import { identityGlanceOf } from './identity-glance-utils';

describe('identityGlanceOf', () => {
  it('marks a user account as human', () => {
    expect(identityGlanceOf('identity', 'user_account')).toBe('human');
  });

  it('marks a service account and an application identity as non-human, which is most of a real tenant', () => {
    expect(identityGlanceOf('identity', 'service_account')).toBe('non-human');
    expect(identityGlanceOf('identity', 'non_human_identity')).toBe('non-human');
  });

  it('marks a group, a role and a shared mailbox as human: someone signs in there', () => {
    expect(identityGlanceOf('identity', 'group')).toBe('human');
    expect(identityGlanceOf('identity', 'role')).toBe('human');
    expect(identityGlanceOf('identity', 'shared_mailbox')).toBe('human');
  });

  it('marks nothing on a row that is not an identity', () => {
    expect(identityGlanceOf('host', 'server')).toBeNull();
    expect(identityGlanceOf('ai_target', 'llm_model')).toBeNull();
  });

  it('marks nothing when no source stated a subcategory, rather than reading an absence as non-human', () => {
    expect(identityGlanceOf('identity', null)).toBeNull();
  });
});
