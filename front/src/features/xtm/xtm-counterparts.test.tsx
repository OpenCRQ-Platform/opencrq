/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmCounterpart, XtmEmblemInput } from './xtm-counterparts';
import { FAILED, NEVER, renderWithTrpc } from '../../providers/trpc-test-harness';
import { XtmConnectTeaser, xtmEmblemState, XtmPivotEmblems, XtmPivotPreview, XtmRowMarks, xtmSourceProducts } from './xtm-counterparts';

const canConfigure = vi.fn<() => boolean>();
vi.mock('../../hooks/utils/use-has-manage-security', () => ({ useHasManageSecurity: () => canConfigure() }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: ({ children, params, className, 'aria-label': label }: { children: ReactNode, params: { connectorSlug: string }, className?: string, 'aria-label'?: string }) => (
    <a href={`/integrations/connectors/${params.connectorSlug}`} aria-label={label} className={className}>{children}</a>
  ),
}));

const CVE = 'CVE-2024-3400';
const CONNECTED = [
  { product: 'opencti', connected: true, url: 'https://opencti.example' },
  { product: 'openaev', connected: false, url: null },
];
const BOTH = [
  { product: 'opencti', connected: true, url: 'https://opencti.example' },
  { product: 'openaev', connected: true, url: 'https://openaev.example' },
];
const MATCH: XtmCounterpart = {
  key: CVE, product: 'opencti', objectId: 'v1', objectType: 'Vulnerability', objectName: 'PAN-OS GlobalProtect', objectUrl: 'https://opencti.example/dashboard/id/v1',
  facts: [{ key: 'findings', value: '3' }],
};
const SOURCED: XtmCounterpart = {
  key: 'ww-onedev-worker-001', product: 'openaev', objectId: 'a1', objectType: 'Asset', objectName: 'ww-onedev-worker-001', objectUrl: 'https://openaev.example/admin/assets/a1', facts: [],
};

beforeAll(() => i18n.load('en', {}));
beforeEach(() => {
  i18n.activate('en');
  canConfigure.mockReturnValue(true);
});
afterEach(() => cleanup());

const renderEmblems = (counterparts: unknown, connections: unknown = CONNECTED, objectKey: string | null = CVE, sourced?: Partial<Record<'opencti' | 'openaev', XtmCounterpart>>) => renderWithTrpc(
  <XtmPivotEmblems kind="VULNERABILITY" objectKey={objectKey} sourced={sourced} />,
  { answers: { 'xtm.connections': connections, 'xtm.counterparts': counterparts } },
);

describe('XtmPivotEmblems', () => {
  it('draws one icon-only emblem per product, OpenCTI then OpenAEV, with no text', async () => {
    const { container } = renderEmblems([MATCH]);
    const found = await screen.findByRole('link', { name: 'Open in OpenCTI' });
    expect(found.getAttribute('href')).toBe('https://opencti.example/dashboard/id/v1');
    expect(found.getAttribute('target')).toBe('_blank');
    const connect = screen.getByRole('link', { name: 'Connect OpenAEV' });
    expect(container.textContent).toBe('');
    expect(found.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('greys a connected product that does not hold the object, still focusable and named', async () => {
    renderEmblems([], BOTH);
    const notFound = await screen.findByRole('button', { name: 'Not found in OpenCTI' });
    expect(notFound.getAttribute('aria-disabled')).toBe('true');
    expect(notFound.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Not found in OpenAEV' })).toBeTruthy();
  });

  it('gives a reader who cannot configure a disabled emblem for a product not connected', async () => {
    canConfigure.mockReturnValue(false);
    renderEmblems([MATCH]);
    const emblem = await screen.findByRole('button', { name: 'OpenAEV is not connected' });
    expect(emblem.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('link', { name: 'Connect OpenAEV' })).toBeNull();
  });

  it('says a lookup that failed could not reach the product, never "not found"', async () => {
    renderEmblems(FAILED, BOTH);
    expect(await screen.findByRole('button', { name: 'OpenCTI could not be reached' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Not found/ })).toBeNull();
  });

  it('shows the emblems as checking while the lookup loads', async () => {
    renderEmblems(NEVER, BOTH);
    expect(await screen.findByRole('button', { name: 'Looking in OpenCTI…' })).toBeTruthy();
  });

  it('finds a product the object came from by its source link, with no lookup hit needed', async () => {
    renderEmblems([], BOTH, 'ww-onedev-worker-001', { openaev: SOURCED });
    const found = await screen.findByRole('link', { name: 'Open in OpenAEV' });
    expect(found.getAttribute('href')).toBe(SOURCED.objectUrl);
    expect(screen.queryByRole('button', { name: 'Not found in OpenAEV' })).toBeNull();
  });
});

describe('xtmEmblemState', () => {
  const base: XtmEmblemInput = { connected: true, connectionsFailed: false, counterparts: [], lookupFailed: false, hasKey: true };

  it('reads each state from the connection and the lookup', () => {
    expect(xtmEmblemState('opencti', { ...base, counterparts: [MATCH] })).toEqual({ kind: 'found', counterpart: MATCH });
    expect(xtmEmblemState('opencti', base).kind).toBe('not-found');
    expect(xtmEmblemState('opencti', { ...base, connected: false }).kind).toBe('not-connected');
    expect(xtmEmblemState('opencti', { ...base, connected: undefined }).kind).toBe('checking');
    expect(xtmEmblemState('opencti', { ...base, counterparts: undefined }).kind).toBe('checking');
    expect(xtmEmblemState('opencti', { ...base, lookupFailed: true }).kind).toBe('unavailable');
    expect(xtmEmblemState('opencti', { ...base, hasKey: false, counterparts: undefined }).kind).toBe('not-found');
  });

  it('keeps the source link of a sourced object and takes the facts the lookup answered', () => {
    const facts = [{ key: 'findings', value: '2' }];
    const state = xtmEmblemState('openaev', { ...base, sourced: SOURCED, counterparts: [{ ...SOURCED, objectUrl: 'https://elsewhere', facts }] });
    expect(state).toEqual({ kind: 'found', counterpart: { ...SOURCED, facts } });
    expect(xtmEmblemState('openaev', { ...base, connected: undefined, sourced: SOURCED }).kind).toBe('found');
  });
});

describe('xtmSourceProducts', () => {
  it('keeps the XTM products among the sources', () => {
    expect(xtmSourceProducts(['openaev', 'nist', null])).toEqual(['openaev']);
    expect(xtmSourceProducts(['microsoft_graph'])).toEqual([]);
  });
});

describe('XtmConnectTeaser', () => {
  it('shows example fields as labelled skeletons, never figures, and the connect line for a configurer', () => {
    const { container } = renderWithTrpc(<XtmConnectTeaser product="openaev" canConfigure />);
    expect(screen.getByText('OpenAEV is not connected')).toBeTruthy();
    expect(screen.getByText('Simulations')).toBeTruthy();
    expect(screen.getAllByText('Example')).toHaveLength(2);
    expect(screen.getByText('Connect OpenAEV')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('gives a reader the read-only line instead', () => {
    renderWithTrpc(<XtmConnectTeaser product="opencti" canConfigure={false} />);
    expect(screen.getByText('Ask an administrator to connect OpenCTI.')).toBeTruthy();
    expect(screen.queryByText('Connect OpenCTI')).toBeNull();
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
  it('renders a 16 px mark per counterpart found, nothing without', async () => {
    const { container, rerender } = renderWithTrpc(<XtmRowMarks counterparts={[]} />);
    expect(container.textContent).toBe('');
    rerender(<XtmRowMarks counterparts={[MATCH]} />);
    const link = screen.getByRole('link', { name: 'Open in OpenCTI' });
    expect(link.getAttribute('href')).toBe(MATCH.objectUrl);
    await waitFor(() => expect(link.querySelector<HTMLElement>('[data-testid="xtm-mark"]')?.style.width).toBe('16px'));
    // Found: the design system's highlight ink, the same for every product.
    expect(link.querySelector('[data-testid="xtm-mark"]')?.className).toContain('text-icon-highlight');
  });
});
