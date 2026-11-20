import { describe, expect, it } from 'vitest';
import { parseMemberAdded } from './member-added-notification';

describe('parseMemberAdded', () => {
  it('reads who added the reader to which tenant', () => {
    const data = { tenantId: 't-1', tenantName: 'Acme Bank', addedBy: 'Claire Dubois' };

    expect(parseMemberAdded({ type: 'member-added', data })).toEqual({ scope: 'tenant', ...data });
  });

  it('reads the platform groups the reader was added to', () => {
    const data = { platformGroupIds: ['g-1', 'g-2'], platformGroupNames: ['Admin', 'Auditors'], addedBy: 'Claire Dubois' };

    expect(parseMemberAdded({ type: 'member-added', data })).toEqual({ scope: 'platform', groupNames: 'Admin, Auditors', addedBy: 'Claire Dubois' });
  });

  it('leaves any other notification, or one whose data it cannot read, to its stored text', () => {
    expect(parseMemberAdded({ type: 'job-failed', data: { tenantId: 't-1', tenantName: 'Acme Bank', addedBy: 'Claire' } })).toBeNull();
    expect(parseMemberAdded({ type: 'member-added', data: { scopeName: 'Admin' } })).toBeNull();
  });
});
