import { describe, expect, it } from 'vitest';
import { configureSaveSteps } from './opencti-configure-utils';

const SAVED = { streamId: 'stream-1', serviceAccountId: 'account-1' };
const CHOSEN = { ...SAVED, threatVisibility: 'per_member' as const };

describe('configureSaveSteps', () => {
  it('should leave the stream alone when only the visibility changes', () => {
    expect(configureSaveSteps(SAVED, 'per_member', { ...CHOSEN, threatVisibility: 'service_account' })).toEqual({ rebind: false, setVisibility: true });
  });

  it('should bind again when the stream or the account changes, and set the visibility only when it changes too', () => {
    expect(configureSaveSteps(SAVED, 'per_member', { ...CHOSEN, streamId: 'stream-2' })).toEqual({ rebind: true, setVisibility: false });
    expect(configureSaveSteps(SAVED, 'per_member', { ...CHOSEN, serviceAccountId: null, threatVisibility: 'service_account' })).toEqual({ rebind: true, setVisibility: true });
  });

  it('should bind again on a save that changes nothing, as before', () => {
    expect(configureSaveSteps(SAVED, 'service_account', { ...CHOSEN, threatVisibility: 'service_account' })).toEqual({ rebind: true, setVisibility: false });
  });

  it('should set the visibility of a tenant with no stream bound yet along with the binding', () => {
    expect(configureSaveSteps(null, 'per_member', CHOSEN)).toEqual({ rebind: true, setVisibility: false });
    expect(configureSaveSteps(null, 'per_member', { ...CHOSEN, threatVisibility: 'service_account' })).toEqual({ rebind: true, setVisibility: true });
  });
});
