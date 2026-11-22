/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmCounterpart } from './xtm-counterparts';
import { FAILED, renderWithTrpc } from '../../providers/trpc-test-harness';
import { XtmConnectActions, XtmCounterpartPivots, XtmPivotButtons, XtmPivotPreview, XtmRowMarks, xtmSourceProducts } from './xtm-counterparts';

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

const renderPivots = (counterparts: unknown, connections: unknown = CONNECTED, skip?: ReadonlyArray<'opencti' | 'openaev'>) => renderWithTrpc(
  <XtmCounterpartPivots kind="VULNERABILITY" objectKey={CVE} skip={skip} />,
  { answers: { 'xtm.connections': connections, 'xtm.counterparts': counterparts } },
);

describe('XtmCounterpartPivots', () => {
  it('opens the counterpart in the connected product, with no card on the page', async () => {
    const { container } = renderPivots([MATCH]);
    const link = await screen.findByRole('link', { name: 'Open in OpenCTI' });
    expect(link.getAttribute('href')).toBe('https://opencti.example/dashboard/id/v1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(container.textContent).not.toContain('In OpenCTI');
    expect(screen.queryByTestId('xtm-preview')).toBeNull();
  });

  it('renders nothing when the connected product does not hold the object', async () => {
    const { container } = renderPivots([]);
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.textContent).not.toContain('Not found');
  });

  it('renders nothing while the product is not connected (the connect call to action covers it)', async () => {
    const { container } = renderPivots([{ ...MATCH, product: 'openaev' }]);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('degrades silently when the lookup fails', async () => {
    const { container } = renderPivots(FAILED);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('renders nothing while the connections are unknown', async () => {
    const { container } = renderPivots([MATCH], FAILED);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('never pivots to a product the object came from (its source row is the pivot)', async () => {
    const { container } = renderPivots([MATCH], CONNECTED, ['opencti']);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('xtmSourceProducts', () => {
  it('keeps the XTM products among the sources', () => {
    expect(xtmSourceProducts(['openaev', 'nist', null])).toEqual(['openaev']);
    expect(xtmSourceProducts(['microsoft_graph'])).toEqual([]);
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

describe('XtmPivotPreview', () => {
  it('shows what the click opens: product, type, name, facts and the next step', () => {
    renderWithTrpc(<XtmPivotPreview counterpart={MATCH} />);
    expect(screen.getByText('OpenCTI')).toBeTruthy();
    expect(screen.getByText('Vulnerability')).toBeTruthy();
    expect(screen.getByText('PAN-OS GlobalProtect')).toBeTruthy();
    expect(screen.getByText('Findings')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText(/See the reports, relationships and context/)).toBeTruthy();
  });

  it('leaves the fact list out when the product answered none', () => {
    const { container } = renderWithTrpc(<XtmPivotPreview counterpart={{ ...MATCH, facts: [] }} />);
    expect(container.querySelector('dl')).toBeNull();
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
