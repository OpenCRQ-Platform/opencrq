import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from '../../xtm-one/xtm-one-config';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const SETTINGS: XtmOneSettings = { url: 'http://xtm-one:4000', token: 'registration-token', platformUrl: 'https://opencrq.example.com' };
vi.mock('../../xtm-one/xtm-one-config', () => ({ getXtmOneSettings: () => SETTINGS }));
// The per-user token is signed with the platform's keys; this suite is about what the router asks XTM One.
vi.mock('../../xtm-one/xtm-one-headers', () => ({ buildXtmOneHeaders: () => Promise.resolve({ Authorization: 'Bearer per-user-jwt' }) }));

const { trpcInstance } = await import('../../../trpc');
const { membersRouter } = await import('./members-router');

const findTenantMembersAmong = vi.fn();
const addTenantMembers = vi.fn();
const services = { withOrigin: () => ({ members: { findTenantMembersAmong, addTenantMembers } }) };
const origin = { type: 'client', userId: 'user-1', tenantId: 'tenant-1' };
const user = { id: 'user-1', email: 'admin@acme.com', name: 'Admin' };

// The tenant security procedure's capability check is the integration tests' concern; here it only hands the context over.
const procedure = trpcInstance.procedure.use(({ next }) => next({ ctx: { services, origin, user } }));
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the router reads only the context fields set above
const caller = membersRouter(procedure as never, {} as never).createCaller({ serviceAccount: null } as never);

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  findTenantMembersAmong.mockReset().mockResolvedValue([]);
  addTenantMembers.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('members.searchDirectory', () => {
  it('offers a typed email longer than XTM One\'s directory accepts, without asking the directory', async () => {
    const email = `jane.martin@${'subsidiary-'.repeat(5)}x.${'region-'.repeat(8)}y.acme.com`;

    await expect(caller.searchDirectory({ query: email })).resolves.toEqual({ people: [], typedEmail: { email, alreadyMember: false } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findTenantMembersAmong).toHaveBeenCalledWith([email], []);
  });

  it('asks the directory for a query it accepts', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'u-1', full_name: 'Jane Martin', email: 'jane@acme.com' }]), { status: 200 }));

    await expect(caller.searchDirectory({ query: 'jane' })).resolves.toEqual({
      people: [{ id: 'u-1', fullName: 'Jane Martin', email: 'jane@acme.com', alreadyMember: false }],
      typedEmail: null,
    });
  });

  it('refuses a query longer than any email', async () => {
    await expect(caller.searchDirectory({ query: `${'j'.repeat(246)}@acme.com` })).rejects.toThrow();
  });
});

describe('members.addMembers', () => {
  it('hands the drawer an invitation XTM One already holds (409) as a refusal of its own', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'An invitation is already pending' }), { status: 409 }));
    addTenantMembers.mockImplementation(async (members: Array<{ email: string }>, _groupIds: Array<string>, send: (request: object) => Promise<{ outcome: string }>) => {
      const answer = await send({ email: members[0].email, path: '/join/token', scopeName: 'Acme Corp' });
      expect(answer).toEqual({ outcome: 'invitation-pending' });
      return {
        scopeName: 'Acme Corp',
        scopePath: '/tenant-1',
        results: [{ email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'invitation-pending' }],
      };
    });

    await expect(caller.addMembers({ members: [{ email: 'jane@acme.com' }], groupIds: [] })).resolves.toEqual({
      scopeName: 'Acme Corp',
      accessLink: 'https://opencrq.example.com/tenant-1',
      results: [{ email: 'jane@acme.com', added: false, emailSent: false, invited: false, invitationLink: null, refusal: 'invitation-pending' }],
    });
  });
});
