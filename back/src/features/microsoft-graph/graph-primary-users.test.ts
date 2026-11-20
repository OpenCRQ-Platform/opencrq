import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntraDevice, HeldPrimaryUser, IntuneDevice } from './graph-primary-users';
import { describePrimaryUserPass, readEntraDevices, resolvePrimaryUsers, retiredPrimaryUsers } from './graph-primary-users';

const device = (supportingAssetId: string, directoryDeviceId: string | null, macAddresses: Array<string> = [], lastSeenAt: Date | null = new Date('2026-10-01T08:00:00Z')) =>
  ({ supportingAssetId, directoryDeviceId, macAddresses, lastSeenAt });
const identity = (supportingAssetId: string, sourceAssetId: string) => ({ supportingAssetId, sourceAssetId });
const entra = (deviceId: string, ...owners: Array<string>): EntraDevice => ({ deviceId, registeredOwners: owners.map((id) => ({ id })) });
const intune = (overrides: IntuneDevice): IntuneDevice => ({ azureADDeviceId: null, userId: null, wiFiMacAddress: null, ethernetMacAddress: null, ...overrides });

const held = (id: string, fromAssetId: string, toAssetId: string, source: HeldPrimaryUser['source']): HeldPrimaryUser => ({ id, fromAssetId, toAssetId, source });

const identities = [identity('nadia', 'obj-nadia'), identity('tomas', 'obj-tomas')];

const resolve = (input: Omit<Parameters<typeof resolvePrimaryUsers>[0], 'held'> & { held?: Array<HeldPrimaryUser> }) =>
  resolvePrimaryUsers({ held: [], ...input });

describe('resolvePrimaryUsers', () => {
  it('reads the Entra registered owner of a device joined on its Entra device id', () => {
    expect(resolve({
      devices: [device('laptop-1', 'aad-1')],
      identities,
      entraDevices: [entra('AAD-1', 'OBJ-NADIA')],
      intuneDevices: null,
    })).toEqual([{ identityAssetId: 'nadia', deviceAssetId: 'laptop-1', source: 'entra_registered_owner' }]);
  });

  it('takes the Intune primary user over the Entra owner, and reads nothing else from Entra for that device', () => {
    expect(resolve({
      devices: [device('laptop-1', 'aad-1')],
      identities,
      entraDevices: [entra('aad-1', 'obj-nadia')],
      intuneDevices: [intune({ azureADDeviceId: 'aad-1', userId: 'obj-tomas' })],
    })).toEqual([{ identityAssetId: 'tomas', deviceAssetId: 'laptop-1', source: 'intune_primary_user' }]);
  });

  it('falls back on the Entra owner when Intune names no user', () => {
    expect(resolve({
      devices: [device('laptop-1', 'aad-1')],
      identities,
      entraDevices: [entra('aad-1', 'obj-nadia')],
      intuneDevices: [intune({ azureADDeviceId: 'aad-1', userId: '00000000-0000-0000-0000-000000000000' })],
    })).toEqual([{ identityAssetId: 'nadia', deviceAssetId: 'laptop-1', source: 'entra_registered_owner' }]);
  });

  it('joins Intune on a MAC for a device Defender holds no Entra device id for', () => {
    expect(resolve({
      devices: [device('mac-1', null, ['a4b1c2d3e4f5'])],
      identities,
      entraDevices: [],
      intuneDevices: [intune({ azureADDeviceId: 'aad-unknown', userId: 'obj-nadia', wiFiMacAddress: 'a4b1c2d3e4f5' })],
    })).toEqual([{ identityAssetId: 'nadia', deviceAssetId: 'mac-1', source: 'intune_primary_user' }]);
  });

  it('joins no MAC two device assets carry, as a dock\'s or a USB-C adapter\'s does', () => {
    expect(resolve({
      devices: [device('mac-1', null, ['a4b1c2d3e4f5']), device('laptop-2', 'aad-2', ['a4b1c2d3e4f5'])],
      identities,
      entraDevices: [],
      intuneDevices: [intune({ userId: 'obj-nadia', ethernetMacAddress: 'a4b1c2d3e4f5' })],
    })).toEqual([]);
  });

  it('joins no MAC two Intune devices carry', () => {
    expect(resolve({
      devices: [device('mac-1', null, ['a4b1c2d3e4f5'])],
      identities,
      entraDevices: [],
      intuneDevices: [
        intune({ userId: 'obj-nadia', ethernetMacAddress: 'a4b1c2d3e4f5' }),
        intune({ userId: 'obj-tomas', ethernetMacAddress: 'a4b1c2d3e4f5' }),
      ],
    })).toEqual([]);
  });

  it('joins nothing when the Wi-Fi and the Ethernet MAC name two different assets', () => {
    expect(resolve({
      devices: [device('mac-1', null, ['a4b1c2d3e4f5']), device('mac-2', null, ['0a1b2c3d4e5f'])],
      identities,
      entraDevices: [],
      intuneDevices: [intune({ userId: 'obj-nadia', wiFiMacAddress: 'a4b1c2d3e4f5', ethernetMacAddress: '0a1b2c3d4e5f' })],
    })).toEqual([]);
  });

  it('makes no relation to an owner that is not one of the connector\'s identities', () => {
    expect(resolve({
      devices: [device('laptop-1', 'aad-1')],
      identities,
      entraDevices: [entra('aad-1', 'obj-someone-else')],
      intuneDevices: null,
    })).toEqual([]);
  });

  it('gives a reinstalled machine\'s primary user to its record still in use, not to the one it left behind', () => {
    const devices = [
      device('laptop-1-before-reinstall', 'aad-1', [], new Date('2026-09-21T16:57:00Z')),
      device('laptop-1', 'aad-1', [], new Date('2026-10-01T14:30:00Z')),
    ];
    expect(resolve({ devices, identities, entraDevices: [entra('aad-1', 'obj-nadia')], intuneDevices: null })
      .map((user) => user.deviceAssetId)).toEqual(['laptop-1']);
    expect(resolve({ devices, identities, entraDevices: [], intuneDevices: [intune({ azureADDeviceId: 'aad-1', userId: 'obj-nadia' })] })
      .map((user) => user.deviceAssetId)).toEqual(['laptop-1']);
  });

  it('reads nothing from a source that did not answer', () => {
    expect(resolve({ devices: [device('laptop-1', 'aad-1')], identities, entraDevices: null, intuneDevices: null })).toEqual([]);
  });

  it('keeps Entra off a device Intune named at its last answer, while Intune does not answer', () => {
    expect(resolve({
      devices: [device('laptop-1', 'aad-1'), device('laptop-2', 'aad-2')],
      identities,
      entraDevices: [entra('aad-1', 'obj-nadia'), entra('aad-2', 'obj-nadia')],
      intuneDevices: null,
      held: [held('held-1', 'tomas', 'laptop-1', 'intune_primary_user')],
    })).toEqual([{ identityAssetId: 'nadia', deviceAssetId: 'laptop-2', source: 'entra_registered_owner' }]);
  });

  it('reads Entra again on a device Intune named once it answers without naming it', () => {
    expect(resolve({
      devices: [device('laptop-1', 'aad-1')],
      identities,
      entraDevices: [entra('aad-1', 'obj-nadia')],
      intuneDevices: [],
      held: [held('held-1', 'tomas', 'laptop-1', 'intune_primary_user')],
    })).toEqual([{ identityAssetId: 'nadia', deviceAssetId: 'laptop-1', source: 'entra_registered_owner' }]);
  });
});

describe('retiredPrimaryUsers', () => {
  const observed = (identityAssetId: string, deviceAssetId: string, source: HeldPrimaryUser['source']) => ({ identityAssetId, deviceAssetId, source });

  it('retires what a source that answered no longer names', () => {
    expect(retiredPrimaryUsers({
      held: [held('held-1', 'nadia', 'laptop-1', 'entra_registered_owner'), held('held-2', 'nadia', 'laptop-2', 'entra_registered_owner')],
      observed: [observed('nadia', 'laptop-1', 'entra_registered_owner')],
      answeredSources: ['entra_registered_owner'],
    })).toEqual(['held-2']);
  });

  it('keeps what a source that did not answer named', () => {
    expect(retiredPrimaryUsers({
      held: [held('held-1', 'tomas', 'laptop-1', 'intune_primary_user')],
      observed: [observed('nadia', 'laptop-2', 'entra_registered_owner')],
      answeredSources: ['entra_registered_owner'],
    })).toEqual([]);
  });

  it('retires, on a device the pass names, what a source that did not answer named there', () => {
    expect(retiredPrimaryUsers({
      held: [held('held-1', 'tomas', 'laptop-1', 'entra_registered_owner')],
      observed: [observed('nadia', 'laptop-1', 'intune_primary_user')],
      answeredSources: ['intune_primary_user'],
    })).toEqual(['held-1']);
  });

  it('never retires a pair the pass names again, whichever source names it now', () => {
    expect(retiredPrimaryUsers({
      held: [held('held-1', 'nadia', 'laptop-1', 'entra_registered_owner')],
      observed: [observed('nadia', 'laptop-1', 'intune_primary_user')],
      answeredSources: ['entra_registered_owner', 'intune_primary_user'],
    })).toEqual([]);
  });
});

describe('readEntraDevices', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the next link until the collection ends', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [entra('aad-1', 'obj-nadia')], '@odata.nextLink': 'https://graph.microsoft.com/next' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [entra('aad-2')] })));
    vi.stubGlobal('fetch', fetchMock);

    const read = await readEntraDevices('tok', new AbortController().signal);

    expect(read).toEqual({ status: 'answered', items: [entra('aad-1', 'obj-nadia'), entra('aad-2')] });
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.microsoft.com/next');
  });

  it('reads a 403 as the tenant refusing the source, not as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":"Authorization_RequestDenied"}}', { status: 403 })));

    await expect(readEntraDevices('tok', new AbortController().signal)).resolves.toEqual({ status: 'refused', httpStatus: 403 });
  });

  it('reads any other error status as the source unavailable, even after a page it answered', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [entra('aad-1', 'obj-nadia')], '@odata.nextLink': 'https://graph.microsoft.com/next' })))
      .mockResolvedValueOnce(new Response('oops', { status: 503 })));

    await expect(readEntraDevices('tok', new AbortController().signal)).resolves.toEqual({ status: 'unavailable', reason: '503' });
  });

  it('reads a tenant without the service, which answers 400, as the source unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":"BadRequest","message":"Request not applicable to target tenant."}}', { status: 400 })));

    await expect(readEntraDevices('tok', new AbortController().signal)).resolves.toEqual({ status: 'unavailable', reason: '400' });
  });

  it('reads a timeout as the source unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError')));

    await expect(readEntraDevices('tok', new AbortController().signal)).resolves.toEqual({ status: 'unavailable', reason: 'timed out', error: expect.any(DOMException) });
  });

  it('reads a body that is not JSON as the source unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway</html>')));

    await expect(readEntraDevices('tok', new AbortController().signal)).resolves.toEqual({ status: 'unavailable', reason: 'unexpected response', error: expect.any(SyntaxError) });
  });

  it('keeps the error of a request that failed, so the logs can tell one failure from another', async () => {
    const failure = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND graph.microsoft.com') });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    await expect(readEntraDevices('tok', new AbortController().signal)).resolves.toEqual({ status: 'unavailable', reason: 'unreachable', error: failure });
  });

  it('throws when the job itself is aborted', async () => {
    const job = new AbortController();
    job.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('This operation was aborted', 'AbortError')));

    await expect(readEntraDevices('tok', job.signal)).rejects.toThrow('aborted');
  });
});

describe('describePrimaryUserPass', () => {
  it('says one primary user in the singular', () => {
    expect(describePrimaryUserPass(1, { status: 'answered', items: [] }, { status: 'answered', items: [] }))
      .toBe('1 primary user; Microsoft Entra ID answered, Intune answered');
  });

  it('names the sources that answered and the ones that refused', () => {
    expect(describePrimaryUserPass(12, { status: 'answered', items: [] }, { status: 'refused', httpStatus: 403 }))
      .toBe('12 primary users; Microsoft Entra ID answered, Intune refused (403)');
  });

  it('says why a source was unavailable', () => {
    expect(describePrimaryUserPass(0, { status: 'unavailable', reason: 'timed out' }, { status: 'unavailable', reason: '400' }))
      .toBe('0 primary users; Microsoft Entra ID unavailable (timed out), Intune unavailable (400)');
  });
});
