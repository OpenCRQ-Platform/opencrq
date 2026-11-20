import { describe, expect, it, vi } from 'vitest';

let xtmOne: unknown;

vi.mock('../../config', () => ({
  config: () => ({ xtm_one: xtmOne }),
}));

const { getXtmOneSettings } = await import('./xtm-one-config');

describe('getXtmOneSettings', () => {
  it('returns null when the block is absent', () => {
    xtmOne = undefined;

    expect(getXtmOneSettings()).toBeNull();
  });

  it('strips trailing slashes from both URLs and leaves the token untouched', () => {
    xtmOne = {
      url: 'https://xtm-one.example.com/',
      token: 'registration-token',
      platform_url: 'https://opencrq.example.com//',
    };

    expect(getXtmOneSettings()).toEqual({
      url: 'https://xtm-one.example.com',
      token: 'registration-token',
      platformUrl: 'https://opencrq.example.com',
    });
  });
});
