/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ThreatCatalogKpiBand } from './threat-catalog-kpi-band';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const KPIS = { threatActors: 1, intrusionSets: 14, campaigns: 2, active: 12, strongOutcomeMatches: 5, targetedCves: 40, targetedCvesOnEstate: 3 };

const renderBand = (answer: unknown = KPIS) => renderWithTrpc(<ThreatCatalogKpiBand />, { answers: { 'threats.getCatalogKpis': answer } });

describe('ThreatCatalogKpiBand', () => {
  it('shows the active threats out of the whole catalogue, split by type', async () => {
    renderBand();

    expect(await screen.findByText('Active threats')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('out of 17 threats: 1 threat actor, 14 intrusion sets, 2 campaigns')).toBeTruthy();
  });

  it('shows the threats strongly matching an attack outcome, against the threshold the list colours at', async () => {
    renderBand();

    expect(await screen.findByText('Strong match with your outcomes')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('at least 60% with one of your attack outcomes')).toBeTruthy();
  });

  it('shows the targeted CVEs and how many of them the estate carries', async () => {
    renderBand();

    expect(await screen.findByText('Targeted CVEs')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('3 of them on your estate')).toBeTruthy();
  });

  it('explains each new figure in its tooltip', async () => {
    renderBand();
    await screen.findByText('Targeted CVEs');

    act(() => screen.getByRole('button', { name: /Strong match with your outcomes/ }).focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe('Threats whose top attack outcome reaches 60%, the level at which its chip turns red.');

    act(() => screen.getByRole('button', { name: /Targeted CVEs/ }).focus());
    await waitFor(() => expect(screen.getByRole('tooltip').textContent)
      .toBe('A CVE several threats target counts once, among the claims that pass the confidence gate. It is on your estate when it is one of your unique findings, read on the whole estate whatever the risk scope.'));
  });

  it('lays the three cards out in the order of the design', async () => {
    renderBand();
    await screen.findByText('Targeted CVEs');

    const labels = ['Active threats', 'Strong match with your outcomes', 'Targeted CVEs'].map((label) => screen.getByText(label));
    expect(labels[0].compareDocumentPosition(labels[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(labels[1].compareDocumentPosition(labels[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('holds a placeholder until the volumes answer', () => {
    renderBand(NEVER);

    expect(screen.queryByText('Active threats')).toBeNull();
    expect(screen.queryByText('Targeted CVEs')).toBeNull();
  });
});
