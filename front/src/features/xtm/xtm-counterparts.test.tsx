/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmCounterpart, XtmEmblemInput } from './xtm-counterparts';
import { FAILED, NEVER, renderWithTrpc } from '../../providers/trpc-test-harness';
import { emblemProducts, factValueLabel, howItGetsThere, safeCounterpartUrl, visibleSurfaceSections, XtmConnectTeaser, xtmEmblemState, XtmPivotEmblems, XtmPivotPreview, XtmRowMarks, xtmSourceProducts } from './xtm-counterparts';

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

const openSurface = async () => {
  const emblem = await screen.findByTestId('xtm-emblem');
  fireEvent.click(emblem);
  return { emblem, surface: await screen.findByTestId('xtm-surface') };
};

describe('XtmPivotEmblems (single XTM One emblem, parity with opencti #20153)', () => {
  it('draws one icon-only emblem, purple when a product holds the object, with no text', async () => {
    const { container } = renderEmblems([MATCH]);
    const emblem = await screen.findByRole('button', { name: 'Across the XTM Platform' });
    expect(container.textContent).toBe('');
    expect(screen.getAllByTestId('xtm-emblem')).toHaveLength(1);
    expect(emblem.querySelector('[data-testid="xtm-mark"]')?.className).toContain('text-filigran-ia-primary');
  });

  it('opens an anchored surface: the found product with its open button, a Connect entry for a configurer', async () => {
    renderEmblems([MATCH]);
    const { surface } = await openSurface();
    const opencti = within(surface).getByTestId('xtm-section-opencti');
    expect(opencti.getAttribute('data-status')).toBe('found');
    const open = within(opencti).getByRole('link', { name: 'Open in OpenCTI' });
    expect(open.getAttribute('href')).toBe('https://opencti.example/dashboard/id/v1');
    expect(open.getAttribute('target')).toBe('_blank');
    const openaev = within(surface).getByTestId('xtm-section-openaev');
    expect(openaev.getAttribute('data-status')).toBe('not-connected');
    expect(within(openaev).getByRole('link', { name: 'Connect OpenAEV' })).toBeTruthy();
    expect(opencti.compareDocumentPosition(openaev) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('greys the emblem when no product holds the object, and says how it gets there', async () => {
    renderEmblems([], BOTH);
    const emblem = await screen.findByRole('button', { name: 'Not found across the XTM Platform' });
    expect(emblem.querySelector('[data-testid="xtm-mark"]')?.className).toContain('text-icon-disabled');
    const { surface } = await openSurface();
    expect(within(surface).getByTestId('xtm-section-opencti').getAttribute('data-status')).toBe('not-found');
  });

  it('leaves a product not connected out for a reader who cannot configure', async () => {
    canConfigure.mockReturnValue(false);
    renderEmblems([MATCH]);
    const { surface } = await openSurface();
    expect(within(surface).queryByTestId('xtm-section-openaev')).toBeNull();
    expect(within(surface).queryByRole('link', { name: 'Connect OpenAEV' })).toBeNull();
  });

  it('draws nothing when there is nothing to show', async () => {
    canConfigure.mockReturnValue(false);
    const { container } = renderEmblems([], [{ product: 'opencti', connected: false, url: null }, { product: 'openaev', connected: false, url: null }]);
    await waitFor(() => expect(container.querySelector('[data-testid="xtm-emblem"]')).toBeNull());
  });

  it('says a lookup that failed could not reach the product, never "not found"', async () => {
    renderEmblems(FAILED, BOTH);
    const { surface } = await openSurface();
    expect(within(surface).getByTestId('xtm-section-opencti').getAttribute('data-status')).toBe('unavailable');
  });

  it('puts XTM One first on an asset, and never a connector link for XTM One', async () => {
    const xtmOne: XtmCounterpart = {
      key: 'web-01', product: 'xtmone', objectId: 'x1', objectType: 'asset', objectName: 'web-01', objectUrl: 'https://xtm-one.example/ctem/inventory/assets/x1',
      facts: [{ key: 'criticality', value: 'very_high' }, { key: 'category', value: 'generic_asset' }],
    };
    renderWithTrpc(
      <XtmPivotEmblems kind="ASSET" objectKey="web-01" />,
      { answers: { 'xtm.connections': [{ product: 'xtmone', connected: true, url: 'https://xtm-one.example' }, ...BOTH], 'xtm.counterparts': [xtmOne] } },
    );
    const { surface } = await openSurface();
    const sections = within(surface).getAllByRole('region');
    expect(sections[0]?.getAttribute('data-testid')).toBe('xtm-section-xtmone');
    expect(within(sections[0]!).getByRole('link', { name: 'Open in XTM One' }).getAttribute('href')).toBe(xtmOne.objectUrl);
  });

  it('draws no XTM One section outside assets', async () => {
    renderEmblems([], [{ product: 'xtmone', connected: true, url: 'https://xtm-one.example' }, ...BOTH]);
    const { surface } = await openSurface();
    expect(within(surface).queryByTestId('xtm-section-xtmone')).toBeNull();
  });

  it('finds a product the object came from by its source link, with no lookup hit needed', async () => {
    renderEmblems([], BOTH, 'ww-onedev-worker-001', { openaev: SOURCED });
    const { surface } = await openSurface();
    expect(within(surface).getByRole('link', { name: 'Open in OpenAEV' }).getAttribute('href')).toBe(SOURCED.objectUrl);
  });
});

describe('visibleSurfaceSections', () => {
  it('hides checking, and not connected unless the user can connect it (never XTM One)', () => {
    const sections = [
      { product: 'xtmone' as const, state: { kind: 'not-connected' as const } },
      { product: 'opencti' as const, state: { kind: 'checking' as const } },
      { product: 'openaev' as const, state: { kind: 'not-connected' as const } },
    ];
    expect(visibleSurfaceSections(sections, true).map((s) => s.product)).toEqual(['openaev']);
    expect(visibleSurfaceSections(sections, false)).toEqual([]);
  });
});

describe('safeCounterpartUrl', () => {
  it('never follows a non-http link', () => {
    expect(safeCounterpartUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeCounterpartUrl('https://a.example/b')).toBe('https://a.example/b');
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

describe('emblemProducts', () => {
  it('orders XTM One, OpenCTI, OpenAEV on assets and the siblings alone elsewhere', () => {
    expect(emblemProducts('ASSET')).toEqual(['xtmone', 'opencti', 'openaev']);
    expect(emblemProducts('VULNERABILITY')).toEqual(['opencti', 'openaev']);
    expect(emblemProducts('THREAT')).toEqual(['opencti', 'openaev']);
  });
});

describe('howItGetsThere', () => {
  it('names every key the asset lookup sends to XTM One, never a hostname alone', () => {
    expect(howItGetsThere('ASSET', 'xtmone')).toBe('It appears here once a source of the XTM One inventory reports the same OpenAEV asset, name, hostname, URL or address.');
  });

  it('keeps the hostname line for the sibling products', () => {
    expect(howItGetsThere('ASSET', 'opencti')).toBe('It appears here once OpenCTI holds a machine with the same hostname.');
  });
});

describe('factValueLabel', () => {
  it('reads the XTM One inventory enums as labels, other facts as answered', () => {
    expect(factValueLabel('criticality', 'very_high')).toBe('Very High');
    expect(factValueLabel('criticality', 'high')).toBe('High');
    expect(factValueLabel('category', 'generic_asset')).toBe('Generic asset');
    expect(factValueLabel('findings', '3')).toBe('3');
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
