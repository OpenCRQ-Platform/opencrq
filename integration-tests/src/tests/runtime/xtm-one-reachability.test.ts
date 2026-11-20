import { getXtmOneReachability, resetXtmOneReachability } from '@app/back/src/features/xtm-one/xtm-one-reachability';
import { registerWithXtmOne } from '@app/back/src/features/xtm-one/xtm-one-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { startFakeXtmOne } from '../../helpers/fake-xtm-one';
import { db } from '../../setup/db';
import { truncateAllTables } from '../../setup/test-context';

const SETTINGS = { url: 'placeholder', token: 'registration-token', platformUrl: 'https://opencrq.test' };

// Everything but the config layer is real: the socket, the request/response handling and the
// reachability state `registerWithXtmOne` updates as a side effect.
describe('XTM One reachability from a real registration attempt', () => {
  beforeEach(async () => {
    await truncateAllTables(db);
    resetXtmOneReachability();
  });

  it('should record ok when XTM One answers 200', async () => {
    const xtmOne = await startFakeXtmOne(() => ({ status: 'ok', ee_enabled: false }));
    try {
      await registerWithXtmOne({ ...SETTINGS, url: xtmOne.url }, db);
      expect(getXtmOneReachability()).toBe('ok');
    } finally {
      await xtmOne.close();
    }
  });

  it('should record refused when XTM One answers 401', async () => {
    const xtmOne = await startFakeXtmOne(() => ({}), { status: 401 });
    try {
      await registerWithXtmOne({ ...SETTINGS, url: xtmOne.url }, db);
      expect(getXtmOneReachability()).toBe('refused');
    } finally {
      await xtmOne.close();
    }
  });

  it('should record unreachable when XTM One is closed', async () => {
    const xtmOne = await startFakeXtmOne(() => ({ status: 'ok' }));
    await xtmOne.close();

    await registerWithXtmOne({ ...SETTINGS, url: xtmOne.url }, db);

    expect(getXtmOneReachability()).toBe('unreachable');
  });

  it('should record unreachable when the connection drops in the middle of the answer', async () => {
    const xtmOne = await startFakeXtmOne(() => ({}), { cutBody: '{"sta' });
    try {
      await registerWithXtmOne({ ...SETTINGS, url: xtmOne.url }, db);
      expect(getXtmOneReachability()).toBe('unreachable');
    } finally {
      await xtmOne.close();
    }
  });

  it('should record unreadable when XTM One answers 200 with a body that is not JSON', async () => {
    const xtmOne = await startFakeXtmOne(() => ({}), {
      rawBody: { body: '<html><body>Sign in to continue</body></html>', contentType: 'text/html' },
    });
    try {
      await registerWithXtmOne({ ...SETTINGS, url: xtmOne.url }, db);
      expect(getXtmOneReachability()).toBe('unreadable');
    } finally {
      await xtmOne.close();
    }
  });

  it('should record unreadable when XTM One answers 200 with JSON it does not recognise', async () => {
    const xtmOne = await startFakeXtmOne(() => ({ status: 1 }));
    try {
      await registerWithXtmOne({ ...SETTINGS, url: xtmOne.url }, db);
      expect(getXtmOneReachability()).toBe('unreadable');
    } finally {
      await xtmOne.close();
    }
  });

  it('should recover to ok once a refused registration is followed by a successful one', async () => {
    const refusing = await startFakeXtmOne(() => ({}), { status: 401 });
    await registerWithXtmOne({ ...SETTINGS, url: refusing.url }, db);
    await refusing.close();
    expect(getXtmOneReachability()).toBe('refused');

    const accepting = await startFakeXtmOne(() => ({ status: 'ok', ee_enabled: false }));
    try {
      await registerWithXtmOne({ ...SETTINGS, url: accepting.url }, db);
      expect(getXtmOneReachability()).toBe('ok');
    } finally {
      await accepting.close();
    }
  });
});
