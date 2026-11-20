import { describe, expect, it } from 'vitest';
import type { IdentityDetailProperties } from './identity-detail-utils';
import { hasIdentityDetail, hasPropertyCard } from './identity-detail-utils';

const identity = (overrides: Partial<IdentityDetailProperties> = {}): IdentityDetailProperties => ({
  family: 'identity',
  directoryObjectId: null,
  cloudSid: null,
  onPremSid: null,
  userPrincipalName: null,
  accountDomain: null,
  accountName: null,
  directoryType: null,
  identityProvider: null,
  department: null,
  jobTitle: null,
  isEnabled: null,
  assignedRoles: [],
  privilegedPimRoles: [],
  ...overrides,
});

describe('hasIdentityDetail', () => {
  it('finds nothing to show on a block whose every field is absent', () => {
    expect(hasIdentityDetail(identity())).toBe(false);
  });

  it('finds something on the account a logon event alone names, which is a SID and a name', () => {
    expect(hasIdentityDetail(identity({ onPremSid: 'S-1-5-21-1-2-3-1001', accountName: 'jdoe' }))).toBe(true);
  });

  it('counts a disabled account, since false is a reading and not an absence', () => {
    expect(hasIdentityDetail(identity({ isEnabled: false }))).toBe(true);
  });

  it('counts roles on their own', () => {
    expect(hasIdentityDetail(identity({ assignedRoles: ['Global Administrator'] }))).toBe(true);
    expect(hasIdentityDetail(identity({ privilegedPimRoles: ['Security Administrator'] }))).toBe(true);
  });
});

describe('hasPropertyCard', () => {
  it('should draw nothing for an asset without a family block', () => {
    expect(hasPropertyCard(null)).toBe(false);
  });

  it('should draw nothing for an identity without detail, and a card for one with detail', () => {
    expect(hasPropertyCard(identity())).toBe(false);
    expect(hasPropertyCard(identity({ accountName: 'jdoe' }))).toBe(true);
  });

  it('should always draw a card for an AI target', () => {
    expect(hasPropertyCard({ family: 'ai_target', provider: null, endpointUrl: null, normalizedEndpointUrl: null, model: null, modality: null, systemPrompt: null })).toBe(true);
  });
});
