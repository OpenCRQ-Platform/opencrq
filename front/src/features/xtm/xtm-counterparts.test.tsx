/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmCounterpart } from './xtm-counterparts';
import { FAILED, renderWithTrpc } from '../../providers/trpc-test-harness';
import { XtmConnectActions, XtmCounterpartCard, XtmCounterpartCards, XtmPivotButtons, XtmRowMarks } from './xtm-counterparts';

const canConfigure = vi.fn<() => boolean>();
vi.mock('../../hooks/utils/use-has-manage-security', () => ({ useHasManageSecurity: () => canConfigure() }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: ({ children, params, 'aria-label': label }: { children: ReactNode, params: { connectorSlug: string }, 'aria-label'?: string }) => <a href={`/integrations/connectors/${params.connectorSlug}`} aria-label={label}>{children}</a>,
}));

const CVE = 'CVE-2024-3400';
const CONNECTED = [
  { product: 'opencti', connected: true, url: 'https://opencti.example' },
  { product: 'openaev', connected: false, url: null },
];
const MATCH: XtmCounterpart = {
  key: CVE, product: 'opencti', objectId: 'v1', objectType: 'Vulnerability', objectName: 'PAN-OS GlobalProtect', objectUrl: 'https://opencti.example/dashboard/id/v1',
  facts: [{ key: 'findings', value: '3' }],
};

beforeAll(() => i18n.load('en', {}));
beforeEach(() => {
  i18n.activate('en');
  canConfigure.mockReturnValue(true);
});
afterEach(() => cleanup());

const renderCard = (product: 'opencti' | 'openaev', counterparts: unknown, connections: unknown = CONNECTED) => renderWithTrpc(
  <XtmCounterpartCard product={product} kind="VULNERABILITY" objectKey={CVE} />,
  { answers: { 'xtm.connections': connections, 'xtm.counterparts': counterparts } },
);

describe('XtmCounterpartCard', () => {
  it('links the counterpart and shows its key facts', async () => {
    renderCard('opencti', [MATCH]);
    const link = await screen.findByRole('link', { name: 'PAN-OS GlobalProtect' });
    expect(link.getAttribute('href')).toBe('https://opencti.example/dashboard/id/v1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('In OpenCTI')).toBeTruthy();
    expect(screen.getByText('Findings')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('says the connected product does not hold the object', async () => {
    renderCard('opencti', []);
    expect(await screen.findByText('Not found in OpenCTI.')).toBeTruthy();
  });

  it('renders nothing while the product is not connected (the hero carries the call to action)', async () => {
    const { container } = renderCard('openaev', []);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('degrades silently when the lookup fails', async () => {
    renderCard('opencti', FAILED);
    expect(await screen.findByText('Not found in OpenCTI.')).toBeTruthy();
  });

  it('renders nothing while the connections are unknown', async () => {
    const { container } = renderCard('opencti', [MATCH], FAILED);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('XtmCounterpartCards', () => {
  it('shows the cards of the connected products only', async () => {
    renderWithTrpc(
      <XtmCounterpartCards kind="VULNERABILITY" objectKey={CVE} />,
      { answers: { 'xtm.connections': CONNECTED, 'xtm.counterparts': [MATCH] } },
    );
    expect(await screen.findByText('In OpenCTI')).toBeTruthy();
    expect(screen.queryByText('In OpenAEV')).toBeNull();
  });

  it('renders nothing when no product is connected', async () => {
    const { container } = renderWithTrpc(
      <XtmCounterpartCards kind="VULNERABILITY" objectKey={CVE} />,
      { answers: { 'xtm.connections': [{ product: 'opencti', connected: false, url: null }, { product: 'openaev', connected: false, url: null }], 'xtm.counterparts': [] } },
    );
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('XtmConnectActions', () => {
  const renderActions = (products?: ReadonlyArray<'opencti' | 'openaev'>, compact?: boolean) => renderWithTrpc(
    <XtmConnectActions products={products} compact={compact} />,
    { answers: { 'xtm.connections': CONNECTED } },
  );

  it('offers a configurer the connect call to action of each product not connected', async () => {
    renderActions();
    const cta = await screen.findByRole('link', { name: /Connect OpenAEV/ });
    expect(cta.getAttribute('href')).toBe('/integrations/connectors/openaev');
    expect(screen.queryByRole('link', { name: /Connect OpenCTI/ })).toBeNull();
  });

  it('gives a reader who cannot configure a disabled button with a read-only hint', async () => {
    canConfigure.mockReturnValue(false);
    renderActions();
    const button = await screen.findByRole('button', { name: /Connect OpenAEV/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/OpenAEV is not connected/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders the call to action icon-only when compact, named by its label', async () => {
    renderActions(undefined, true);
    const cta = await screen.findByRole('link', { name: 'Connect OpenAEV' });
    expect(cta.textContent).toBe('');
    expect(cta.getAttribute('href')).toBe('/integrations/connectors/openaev');
  });

  it('keeps the read-only hint on the compact disabled button', async () => {
    canConfigure.mockReturnValue(false);
    renderActions(undefined, true);
    const button = await screen.findByRole('button', { name: 'Connect OpenAEV' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toBe('');
    expect(screen.getByText(/OpenAEV is not connected/)).toBeTruthy();
  });

  it('renders nothing for the products left out or connected', async () => {
    const { container } = renderActions(['opencti']);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('XtmPivotButtons', () => {
  it('shows the label wide and only the mark when compact, same accessible name', () => {
    const { rerender } = renderWithTrpc(<XtmPivotButtons counterparts={[MATCH]} />);
    expect(screen.getByRole('link', { name: 'Open in OpenCTI' }).textContent).toBe('Open in OpenCTI');
    rerender(<XtmPivotButtons counterparts={[MATCH]} compact />);
    const link = screen.getByRole('link', { name: 'Open in OpenCTI' });
    expect(link.textContent).toBe('');
    expect(link.getAttribute('href')).toBe(MATCH.objectUrl);
  });
});

describe('XtmRowMarks', () => {
  it('renders one mark per counterpart, nothing without', () => {
    const { container, rerender } = renderWithTrpc(<XtmRowMarks counterparts={[]} />);
    expect(container.textContent).toBe('');
    rerender(<XtmRowMarks counterparts={[MATCH]} />);
    expect(screen.getByRole('link', { name: 'Open in OpenCTI' }).getAttribute('href')).toBe(MATCH.objectUrl);
  });
});
