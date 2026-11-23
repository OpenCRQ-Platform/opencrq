import { describe, expect, it } from 'vitest';
import { configureSaveSteps } from './opencti-configure-utils';

const SAVED = { streamId: 'stream-1', serviceAccountId: 'account-1', threatVisibility: 'per_member' as const };

describe('configureSaveSteps', () => {
  it('should leave the stream alone when only the visibility changes', () => {
    expect(configureSaveSteps(SAVED, { ...SAVED, threatVisibility: 'service_account' })).toEqual({ rebind: false, setVisibility: true });
  });

  it('should bind again when the stream or the account changes, and set the visibility only when it changes too', () => {
    expect(configureSaveSteps(SAVED, { ...SAVED, streamId: 'stream-2' })).toEqual({ rebind: true, setVisibility: false });
    expect(configureSaveSteps(SAVED, { ...SAVED, serviceAccountId: null, threatVisibility: 'service_account' })).toEqual({ rebind: true, setVisibility: true });
  });

  it('should bind again on a save that changes nothing, as before', () => {
    expect(configureSaveSteps(SAVED, SAVED)).toEqual({ rebind: true, setVisibility: false });
  });

  it('should read a tenant with nothing saved as per member', () => {
    expect(configureSaveSteps(null, { ...SAVED, threatVisibility: 'per_member' })).toEqual({ rebind: true, setVisibility: false });
    expect(configureSaveSteps(null, { ...SAVED, threatVisibility: 'service_account' })).toEqual({ rebind: true, setVisibility: true });
  });
});
