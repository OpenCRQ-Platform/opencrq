import { beforeEach, describe, expect, it, vi } from 'vitest';

const answering = vi.hoisted(() => vi.fn<(url: string) => Promise<boolean>>());
vi.mock('./xtm-one-live-probe', () => ({ isXtmOneAnswering: answering }));

const { isXtmSignInReady, recordSignInClientId } = await import('./xtm-sign-in-client');

const XTM_ONE = 'http://localhost:4605';

describe('isXtmSignInReady', () => {
  beforeEach(() => {
    recordSignInClientId(null);
    answering.mockReset();
    answering.mockResolvedValue(true);
  });

  it('is off until XTM One answered a client', async () => {
    await expect(isXtmSignInReady(XTM_ONE)).resolves.toBe(false);
  });

  it('is on with a client while XTM One answers', async () => {
    recordSignInClientId('xtm-platform-opencrq');

    await expect(isXtmSignInReady(XTM_ONE)).resolves.toBe(true);
    expect(answering).toHaveBeenCalledWith(XTM_ONE);
  });

  it('is off with a client while XTM One does not answer', async () => {
    recordSignInClientId('xtm-platform-opencrq');
    answering.mockResolvedValue(false);

    await expect(isXtmSignInReady(XTM_ONE)).resolves.toBe(false);
  });
});
