import { describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from '../../xtm-one/xtm-one-config';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

vi.mock('../../../config', () => ({ config: () => ({}) }));

const settings = vi.hoisted(() => ({ current: null as XtmOneSettings | null }));
vi.mock('../../xtm-one/xtm-one-config', () => ({ getXtmOneSettings: () => settings.current }));

const { readerAuthorization } = await import('./xtm-router');

const USER = { id: 'user-1', email: 'reader@example.com', name: 'Reader' };
const SETTINGS: XtmOneSettings = { url: 'http://xtm-one:4000', token: 'registration-token', platformUrl: 'https://opencrq.example.com' };
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- it reads the user's id, email and name, and the database only once it signs
const authorize = (user: typeof USER | null) => readerAuthorization({} as never, user as never);

describe('readerAuthorization', () => {
  it('should say why it signs nothing without a user or without XTM One', async () => {
    settings.current = SETTINGS;
    const noUser = authorize(null);
    settings.current = null;
    const noIssuer = authorize(USER);

    expect(await noUser('https://opencti.example')).toBeNull();
    expect(noUser.unsigned).toBe('no user to sign for');
    expect(await noIssuer('https://opencti.example')).toBeNull();
    expect(noIssuer.unsigned).toBe('no xtm_one.platform_url configured');
  });

  it('should name no reason when it can sign', () => {
    settings.current = SETTINGS;

    expect(authorize(USER).unsigned).toBeUndefined();
  });
});
