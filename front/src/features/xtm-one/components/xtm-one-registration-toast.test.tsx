/** @vitest-environment jsdom */
import { toast, Toaster } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { XtmOneRegistration } from '../hooks/use-xtm-one-settings';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { XtmOneRegistrationToast } from './xtm-one-registration-toast';

const navigate = vi.fn();
let pathname = '/tenant-1';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ tenantId: 'tenant-1', organizationId: undefined }),
    useLocation: () => ({ pathname }),
  };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  navigate.mockClear();
  pathname = '/tenant-1';
});

interface EditionState {
  edition: 'ce' | 'ee',
  licenseSource: 'local' | 'remote' | null,
  endsAt: string | null,
}

const COMMUNITY: EditionState = { edition: 'ce', licenseSource: null, endsAt: null };

const renderToast = (registration: XtmOneRegistration, flags: Array<string> = [], editionState: EditionState = COMMUNITY) => {
  const settings = { configured: true, url: 'https://xtm.example.test', registration };
  const answers = {
    authStatus: { edition: editionState.edition, featureFlags: flags },
    'edition.getStatus': { ...editionState, licenseExpiresAt: null },
    'xtmOne.getSettings': () => ({ ...settings }),
  };

  // A fresh tree each time: React skips re-rendering an element it is handed again.
  const tree = () => createElement(Fragment, null, createElement(XtmOneRegistrationToast), createElement(Toaster));
  const { queryClient, rerender } = renderWithTrpc(tree(), { answers });

  return { queryClient, settings, rerender: () => rerender(tree()) };
};

describe('XtmOneRegistrationToast', () => {
  it('shows a persistent toast when XTM One is unreachable', async () => {
    renderToast('unreachable');
    await screen.findByText('XTM One cannot be reached. XTM One cannot grant Enterprise Edition to this platform.');
  });

  it('shows a persistent toast when XTM One refuses this platform', async () => {
    renderToast('refused');
    await screen.findByText('This platform\'s registration with XTM One is refused. XTM One cannot grant Enterprise Edition to this platform.');
  });

  it('shows a persistent toast when the registration answer cannot be read', async () => {
    renderToast('unreadable');
    await screen.findByText('This platform\'s registration with XTM One got an answer that cannot be read. XTM One cannot grant Enterprise Edition to this platform.');
  });

  it('does not tell a Community platform it loses Ask Ariane, which is Enterprise-only', async () => {
    renderToast('unreachable');
    await screen.findByText(/XTM One cannot be reached/);
    expect(screen.queryByText(/Ask Ariane/)).toBeNull();
  });

  it('tells a platform entitled by XTM One that Enterprise Edition is no longer extended, and until when', async () => {
    renderToast('unreachable', [], { edition: 'ee', licenseSource: 'remote', endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() });
    await screen.findByText(/^XTM One cannot be reached\. Ask Ariane is unavailable and Enterprise Edition is no longer extended: it ends on .*, or at the next restart\.$/);
  });

  it('tells a platform entitled by an installed license that only Ask Ariane is unavailable', async () => {
    renderToast('refused', [], { edition: 'ee', licenseSource: 'local', endsAt: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString() });
    await screen.findByText('This platform\'s registration with XTM One is refused. Ask Ariane is unavailable.');
    expect(screen.queryByText(/ends on/)).toBeNull();
  });

  it.each([['ok'], ['pending'], [null]] as const)('shows nothing when registration is %s', async (registration) => {
    const { queryClient } = renderToast(registration);
    await waitFor(() => {
      const queries = queryClient.getQueryCache().getAll();
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.every((query) => query.state.status === 'success')).toBe(true);
    });
    expect(screen.queryByText(/XTM One cannot be reached/)).toBeNull();
    expect(screen.queryByText(/registration with XTM One is refused/)).toBeNull();
    expect(screen.queryByText(/got an answer that cannot be read/)).toBeNull();
  });

  it('replaces the message when a later poll reports another cause', async () => {
    const { queryClient, settings } = renderToast('unreachable');
    await screen.findByText(/XTM One cannot be reached/);

    settings.registration = 'unreadable';
    await act(async () => {
      // eslint-disable-next-line no-restricted-syntax -- stands in for the refetchInterval poll: no doorbell rings when XTM One's reachability changes
      await queryClient.refetchQueries();
    });

    await screen.findByText(/got an answer that cannot be read/);
    expect(screen.queryByText(/XTM One cannot be reached/)).toBeNull();
  });

  it('closes the toast once a later poll reports ok, without a page reload', async () => {
    const { queryClient, settings } = renderToast('unreachable');
    await screen.findByText(/XTM One cannot be reached/);

    settings.registration = 'ok';
    await act(async () => {
      // eslint-disable-next-line no-restricted-syntax -- stands in for the refetchInterval poll: no doorbell rings when XTM One's reachability changes
      await queryClient.refetchQueries();
    });

    await waitFor(() => expect(screen.queryByText(/XTM One cannot be reached/)).toBeNull());
  });

  it('comes back at the next poll still reporting the outage once another toast evicted it', async () => {
    const { queryClient } = renderToast('unreachable');
    await screen.findByText(/XTM One cannot be reached/);

    act(() => {
      toast({ description: 'Control created successfully.' });
    });
    await screen.findByText('Control created successfully.');
    expect(screen.queryByText(/XTM One cannot be reached/)).toBeNull();

    await act(async () => {
      // eslint-disable-next-line no-restricted-syntax -- stands in for the refetchInterval poll: no doorbell rings when XTM One's reachability changes
      await queryClient.refetchQueries();
    });

    expect(await screen.findByText(/XTM One cannot be reached/)).toBeDefined();
  });

  it('offers no details link without the enterprise-edition-status flag', async () => {
    renderToast('unreachable');
    await screen.findByText(/XTM One cannot be reached/);
    expect(screen.queryByRole('button', { name: 'Go to details' })).toBeNull();
  });

  it('offers no details link on the page it would open', async () => {
    pathname = '/tenant-1/settings/parameters';
    renderToast('unreachable', ['enterprise-edition-status']);
    await screen.findByText(/XTM One cannot be reached/);
    expect(screen.queryByRole('button', { name: 'Go to details' })).toBeNull();
  });

  it('drops the details link once the reader reaches that page, and brings it back when they leave', async () => {
    const { rerender } = renderToast('unreachable', ['enterprise-edition-status']);
    await screen.findByRole('button', { name: 'Go to details' });

    pathname = '/tenant-1/settings/parameters';
    rerender();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Go to details' })).toBeNull());

    pathname = '/tenant-1/findings';
    rerender();
    expect(await screen.findByRole('button', { name: 'Go to details' })).toBeDefined();
  });

  it('navigates to the tenant\'s settings/parameters when the details link is pressed', async () => {
    renderToast('unreachable', ['enterprise-edition-status']);
    await screen.findByText(/XTM One cannot be reached/);

    fireEvent.click(screen.getByRole('button', { name: 'Go to details' }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/$tenantId/{-$organizationId}/settings/parameters',
      params: { tenantId: 'tenant-1', organizationId: undefined },
    });
  });
});
