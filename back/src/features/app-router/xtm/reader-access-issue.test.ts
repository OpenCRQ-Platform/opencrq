import { describe, expect, it, vi } from 'vitest';
import type { ReaderAuthorization } from './xtm-providers';
import { ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';
import { issueOfTokenFailure, probeReaderIssue } from './reader-access-issue';

describe('issueOfTokenFailure', () => {
  it('should say not linked when XTM One names no platform registered under that URL', () => {
    expect(issueOfTokenFailure(new ReaderTokenUnavailable('refused', 'audience'))).toBe('not_linked');
  });

  it('should say no account when XTM One knows no active user for the reader', () => {
    expect(issueOfTokenFailure(new ReaderTokenUnavailable('refused', 'user'))).toBe('no_account');
  });

  it('should say unavailable for any other refusal, outage or error', () => {
    expect(issueOfTokenFailure(new ReaderTokenUnavailable('HTTP 500'))).toBe('unavailable');
    expect(issueOfTokenFailure(new Error('timeout'))).toBe('unavailable');
    expect(issueOfTokenFailure('not an error')).toBe('unavailable');
  });
});

describe('probeReaderIssue', () => {
  const CONNECTION = { url: 'https://openaev.example', token: 'connector-token' };

  it('should find nothing to say when the member can be read as themselves', async () => {
    const sign = vi.fn(() => Promise.resolve('reader-jwt'));

    expect(await probeReaderIssue(sign, 'openaev', CONNECTION)).toBeNull();
    expect(sign).toHaveBeenCalledWith('openaev', CONNECTION);
  });

  it('should name the category of a refusal, and never ask without an identity to sign for', async () => {
    const refused = (refusal: 'audience' | 'user' | null): ReaderAuthorization =>
      () => Promise.reject(new ReaderTokenUnavailable('refused', refusal));
    const unsigned = Object.assign(vi.fn(() => Promise.resolve(null)), { unsigned: 'no user to sign for' });

    expect(await probeReaderIssue(refused('audience'), 'opencti', CONNECTION)).toBe('not_linked');
    expect(await probeReaderIssue(refused('user'), 'opencti', CONNECTION)).toBe('no_account');
    expect(await probeReaderIssue(refused(null), 'opencti', CONNECTION)).toBe('unavailable');
    expect(await probeReaderIssue(unsigned, 'opencti', CONNECTION)).toBe('not_linked');
    expect(unsigned).not.toHaveBeenCalled();
  });

  it('should say unavailable when no token comes back and no reason is given', async () => {
    expect(await probeReaderIssue(() => Promise.resolve(null), 'opencti', CONNECTION)).toBe('unavailable');
  });
});
