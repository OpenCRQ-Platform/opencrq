import { describe, expect, it } from 'vitest';
import { isCisaListed } from './cisa-listing';

describe('isCisaListed', () => {
  it('is false without a listing date, whatever the kev flag says', () => {
    const connectorFlag = { kev: true, kevUpdatedAt: null };
    expect(isCisaListed({ kevUpdatedAt: null })).toBe(false);
    expect(isCisaListed(connectorFlag)).toBe(false);
  });

  it('is true with a listing date, whatever the kev flag says', () => {
    const kevUpdatedAt = new Date('2026-01-01T00:00:00Z');
    const unflagged = { kev: null, kevUpdatedAt };
    const denied = { kev: false, kevUpdatedAt };
    expect(isCisaListed({ kevUpdatedAt })).toBe(true);
    expect(isCisaListed(unflagged)).toBe(true);
    expect(isCisaListed(denied)).toBe(true);
  });
});
