/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { AskAriane } from './ask-ariane';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useLocation: () => ({ pathname: '/' }) };
});

vi.mock('../../../providers', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('../../../providers')>();
  return { ...actual, useTheme: () => ({ effectiveTheme: 'light' }) };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface LauncherState {
  edition?: 'ce' | 'ee',
  flags?: Array<string>,
  configured?: boolean,
  canManagePlatform?: boolean,
  url?: string,
}

const renderLauncher = ({
  edition = 'ce',
  flags = [],
  configured = true,
  canManagePlatform = false,
  url = 'https://xtm.example.test',
}: LauncherState = {}) => {
  const answers = {
    authStatus: { edition, featureFlags: flags },
    'xtmOne.getSettings': { configured, url },
    'platformCapabilities.hasPlatformAccess': true,
    'platformCapabilities.hasPlatformCapability': canManagePlatform,
  };

  return renderWithTrpc(createElement(AskAriane, { firstName: 'Ada' }), { answers });
};

const launcher = () => screen.queryByRole('button', { name: /Ask Ariane/ });

/**
 * Absence is only evidence once the queries the launcher gates on have
 * answered - asserting it against a still-pending tree passes whatever the
 * component decides.
 */
const settled = async (queryClient: QueryClient) => {
  await waitFor(() => {
    const queries = queryClient.getQueryCache().getAll();
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => query.state.status === 'success')).toBe(true);
  });
};

const eeChip = () => screen.queryByText('EE');

describe('the Ask Ariane launcher', () => {
  it('should offer the assistant without an EE chip on an entitled platform', async () => {
    const { queryClient } = renderLauncher({ edition: 'ee' });
    await settled(queryClient);
    expect(launcher()).not.toBeNull();
    expect(eeChip()).toBeNull();
  });

  it('should show the launcher with an EE chip on a Community platform', async () => {
    const { queryClient } = renderLauncher({ edition: 'ce' });
    await settled(queryClient);
    expect(launcher()).not.toBeNull();
    expect(eeChip()).not.toBeNull();
  });

  it('should not be swayed by the edition-status flag, which gates the Settings card alone', async () => {
    const { queryClient } = renderLauncher({ edition: 'ce', flags: ['enterprise-edition-status'] });
    await settled(queryClient);
    expect(eeChip()).not.toBeNull();
  });

  it('should render nothing without an XTM One deployment to talk to', async () => {
    const { queryClient } = renderLauncher({ edition: 'ee', configured: false });
    await settled(queryClient);
    expect(launcher()).toBeNull();
  });
});

describe('the Enterprise Edition dialog on a Community platform', () => {
  it('should send a platform administrator to the license settings of XTM One', async () => {
    const { queryClient } = renderLauncher({ edition: 'ce', canManagePlatform: true });
    await settled(queryClient);

    fireEvent.click(launcher()!);
    const dialog = await screen.findByRole('dialog', { name: 'Ask Ariane is an Enterprise Edition feature' });

    const install = within(dialog).getByRole('link', { name: 'Install the license in XTM One' });
    expect(install.getAttribute('href')).toBe('https://xtm.example.test/settings/platform');
    expect(install.getAttribute('target')).toBe('_blank');
  });

  it('should offer no install link when the XTM One URL is not http(s)', async () => {
    const { queryClient } = renderLauncher({ edition: 'ce', canManagePlatform: true, url: 'javascript:alert(1)' });
    await settled(queryClient);

    fireEvent.click(launcher()!);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('link')).toBeNull();
  });

  it('should tell any other user to ask an administrator, with nothing to install', async () => {
    const { queryClient } = renderLauncher({ edition: 'ce', canManagePlatform: false });
    await settled(queryClient);

    fireEvent.click(launcher()!);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/Ask an administrator to install the Filigran license/)).toBeTruthy();
    expect(within(dialog).queryByRole('link')).toBeNull();
  });

  it('should give the focus back to the launcher when the dialog closes from the keyboard', async () => {
    const { queryClient } = renderLauncher({ edition: 'ce', canManagePlatform: true });
    await settled(queryClient);

    const button = launcher()!;
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(launcher());
  });

  it('should never open the chat panel nor request a chat route', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json([])));
    vi.stubGlobal('fetch', fetchSpy);
    const { queryClient } = renderLauncher({ edition: 'ce', canManagePlatform: true });
    await settled(queryClient);

    fireEvent.click(launcher()!);
    await screen.findByRole('dialog');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.getElementById('ask-ariane-portal')).toBeNull();
  });
});

describe('the Ask Ariane panel', () => {
  it('should request no chat route the OpenCRQ proxy does not serve', async () => {
    const requested: Array<string> = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      requested.push(url);
      return Promise.resolve(url === '/api/xtm-one/chat/agents'
        ? Response.json([{ id: 'ariane', name: 'Ariane', slug: 'ariane', description: null }])
        : new Response(null, { status: 404 }));
    }));
    renderLauncher({ edition: 'ee' });

    fireEvent.click(await screen.findByRole('button', { name: /Ask Ariane/ }));
    await screen.findByRole('button', { name: 'Summarize our compliance posture' });

    expect(requested).toContain('/api/xtm-one/chat/agents');
    // The chatbot's defaults are all `/chat/*` paths appended to the proxy base,
    // so an endpoint left unset shows up under a doubled `/chat/chat/`.
    expect(requested.filter((url) => url.startsWith('/api/xtm-one/chat/chat/'))).toEqual([]);
  });

  it('should size the composer to its content rather than collapse it to zero height', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json([]))));
    // jsdom has no layout: mimic a browser, where a detached node measures 0.
    const scrollHeight = vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLTextAreaElement) {
        return this.isConnected ? 32 : 0;
      });
    renderLauncher({ edition: 'ee' });

    fireEvent.click(await screen.findByRole('button', { name: /Ask Ariane/ }));
    const composer = await screen.findByRole('textbox');

    expect(composer.style.height).toBe('32px');
    scrollHeight.mockRestore();
  });
});
