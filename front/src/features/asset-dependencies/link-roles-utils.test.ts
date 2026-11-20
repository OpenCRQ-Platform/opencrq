import { describe, expect, it } from 'vitest';
import { securityCriteriaOrder, toggleLinkRole } from './link-roles-utils';

describe('securityCriteriaOrder', () => {
  it('should follow the CIA triad in English', () => {
    expect(securityCriteriaOrder('en')).toEqual(['confidentiality', 'integrity', 'availability', 'traceability']);
  });

  it('should follow DICT in French', () => {
    expect(securityCriteriaOrder('fr')).toEqual(['availability', 'integrity', 'confidentiality', 'traceability']);
  });
});

describe('toggleLinkRole', () => {
  it('should replace unknown with the first role picked', () => {
    expect(toggleLinkRole(['unknown'], 'stores')).toEqual(['stores']);
  });

  it('should add a role beside the ones already picked, in the list order', () => {
    expect(toggleLinkRole(['processes'], 'stores')).toEqual(['stores', 'processes']);
  });

  it('should remove a role picked again', () => {
    expect(toggleLinkRole(['stores', 'processes'], 'stores')).toEqual(['processes']);
  });

  it('should fall back to unknown when the last role is cleared', () => {
    expect(toggleLinkRole(['stores'], 'stores')).toEqual(['unknown']);
  });

  it('should clear every other role when unknown is picked', () => {
    expect(toggleLinkRole(['stores', 'transmits'], 'unknown')).toEqual(['unknown']);
  });
});
