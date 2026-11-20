/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RelevanceProofTarget } from './relevance-proof-panel';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { formatDate } from '../../../utils/date-utils';
import { RelevanceProofPanel } from './relevance-proof-panel';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  // The real Link needs a router; an anchor on the threat id is enough to read where it points.
  const Link = ({ children, params }: { children: ReactNode, params?: { threatId?: string } }) =>
    params?.threatId === undefined ? children : createElement('a', { href: `/threats/${params.threatId}` }, children);
  return { ...actual, Link };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const scenarioTarget: RelevanceProofTarget = {
  scenarioId: 'scenario-1',
  scenarioName: 'Ransomware on the core estate',
  analysisId: 'analysis-1',
  name: 'PhantomLocker',
  combinedRelevance: 0.5,
  resourceLevel: 'government',
  countries: ['France'],
  sectors: ['Defense'],
  matchedCountry: 'France',
  matchedSector: null,
};

type RelevanceProof = inferRouterOutputs<TRPCRouter>['threats']['getRelevanceProof'];

const proof: RelevanceProof = {
  gate: 60,
  unstatedConfidence: 40,
  lastActivityAt: null,
  lastObservedAt: null,
  lastObservedVia: null,
  anchorProvenance: 'none',
  activityScore: 0.4,
  activityWeight: 0.4,
  unknownActivityAgeDays: 365,
  attackOutcomeName: 'Ransomware',
  origin: { stixId: 'intrusion-set--11111111-1111-1111-1111-111111111111', kind: 'connector', entityType: 'intrusion-set' },
  relevance: null,
  outcome: { probability: 0.6, evidenceSufficient: true, modelVersion: '2026.11', judgedOn: null },
};

const OPENCTI_URL = 'https://opencti.example.com';

const renderPanel = (target: RelevanceProofTarget = scenarioTarget, proofValue: RelevanceProof = proof) => {
  const answers = {
    'threats.getRelevanceProof': proofValue,
    'integrations.getConnectorsStatus': { opencti: { url: OPENCTI_URL } },
  };
  return renderWithTrpc(
    createElement(RelevanceProofPanel, { target, onClose: () => {}, onCloseAutoFocus: () => {} }),
    { answers },
  );
};

describe('RelevanceProofPanel outcome and origin', () => {
  it('states the model and its percentage, and nothing of how it got there', async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByText("Assessed by OpenCRQ's internal model")).toBeTruthy());

    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.queryByText(/Not enough data/)).toBeNull();
  });

  it('states a judged percentage with the date of its judgment set instead of the model', async () => {
    renderPanel(scenarioTarget, { ...proof, outcome: { ...proof.outcome, judgedOn: '2026-11-02' } });

    await waitFor(() => expect(screen.getByText(`Judged by OpenCRQ on ${formatDate('2026-11-02')}`)).toBeTruthy());

    expect(screen.queryByText("Assessed by OpenCRQ's internal model")).toBeNull();
    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('says a threat without enough data does not weigh', async () => {
    renderPanel(scenarioTarget, { ...proof, outcome: { ...proof.outcome, evidenceSufficient: false } });

    await waitFor(() => expect(screen.getByText('Not enough data on this threat to weigh it.')).toBeTruthy());
    expect(screen.queryByText('60%')).toBeNull();
  });

  // The actor's STIX id resolves on the tenant's own platform only when the connector put it
  // there, so any other origin is offered no link rather than one that lands nowhere.
  it('links the actor to OpenCTI for a connector origin', async () => {
    renderPanel();

    const link = await screen.findByRole('link', { name: 'Open in OpenCTI' });
    expect(link.getAttribute('href')).toBe(`${OPENCTI_URL}/dashboard/id/intrusion-set--11111111-1111-1111-1111-111111111111`);
  });

  it('offers no OpenCTI link for an origin the connector did not write', async () => {
    renderPanel(scenarioTarget, { ...proof, origin: { ...proof.origin, kind: 'stix-import' } });

    await waitFor(() => expect(screen.getByText("Assessed by OpenCRQ's internal model")).toBeTruthy());

    expect(screen.queryByRole('link', { name: 'Open in OpenCTI' })).toBeNull();
  });
});

describe('RelevanceProofPanel score section', () => {
  it('bands the threat score on the finding bands', async () => {
    renderPanel(scenarioTarget);

    expect(await screen.findByRole('img', { name: 'Threat score: 20 out of 100, Low band' })).toBeTruthy();
  });

  it('opens the arithmetic behind the threat score', async () => {
    renderPanel(scenarioTarget);

    fireEvent.click(await screen.findByRole('button', { name: 'How the threat score is computed' }));

    const dialog = await screen.findByRole('dialog', { name: 'Threat score' });
    expect(within(dialog).getByText('Country: no match')).toBeTruthy();
    expect(within(dialog).getByText('rounded')).toBeTruthy();
  });

  it('names the attributed threat the date comes from under the last activity of the arithmetic', async () => {
    renderPanel(scenarioTarget, {
      ...proof,
      lastObservedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      lastObservedVia: { id: 'campaign-1', name: 'Operation Gilded Checkout' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'How the threat score is computed' }));

    const dialog = await screen.findByRole('dialog', { name: 'Threat score' });
    const link = within(dialog).getByRole('link', { name: 'Operation Gilded Checkout' });
    expect(link.parentElement?.textContent).toBe('via Operation Gilded Checkout');
  });

  it('says nothing of a source in the arithmetic when the threat\'s own date is the latest', async () => {
    renderPanel(scenarioTarget, { ...proof, lastObservedAt: new Date().toISOString(), lastObservedVia: null });

    fireEvent.click(await screen.findByRole('button', { name: 'How the threat score is computed' }));

    const dialog = await screen.findByRole('dialog', { name: 'Threat score' });
    expect(within(dialog).getByText('Last activity')).toBeTruthy();
    expect(within(dialog).queryByText(/^via/)).toBeNull();
  });
});

describe('RelevanceProofPanel score arithmetic of an undated threat', () => {
  const openArithmetic = async (proofValue: RelevanceProof) => {
    renderPanel(scenarioTarget, proofValue);
    fireEvent.click(await screen.findByRole('button', { name: 'How the threat score is computed' }));
    return screen.findByRole('dialog', { name: 'Threat score' });
  };

  it('should say how old an undated activity is counted, with the formula behind its weight', async () => {
    const dialog = await openArithmetic({ ...proof, lastObservedAt: null, unknownActivityAgeDays: 200 });

    expect(within(dialog).getByText('No dated activity is known for this threat, so it is counted as an activity 200 days old.')).toBeTruthy();
    expect(within(dialog).getByText('0.35 × 2^(−200 / 90)')).toBeTruthy();
    expect(within(dialog).getByText(/once its activity is undated, old or made of few observed days/)).toBeTruthy();
    expect(within(dialog).getByText(/an undated activity weighs as one 200 days old/)).toBeTruthy();
  });

  it('should call the activity factor assumed, never observed', async () => {
    const dialog = await openArithmetic({ ...proof, lastObservedAt: null, unknownActivityAgeDays: 200 });

    expect(within(dialog).getAllByText('Assumed activity').length).toBeGreaterThanOrEqual(3);
    expect(within(dialog).queryByText('Observed activity')).toBeNull();
    expect(within(dialog).getByText(/Relevance and assumed activity counted\./)).toBeTruthy();
  });

  it('should word a dated activity without any assumed age', async () => {
    const dialog = await openArithmetic({ ...proof, lastObservedAt: new Date().toISOString(), unknownActivityAgeDays: 200 });

    expect(within(dialog).queryByText(/No dated activity is known/)).toBeNull();
    expect(within(dialog).queryByText(/2\^/)).toBeNull();
    expect(within(dialog).queryByText(/an undated activity weighs/)).toBeNull();
    expect(within(dialog).getByText(/once its activity is old or made of few observed days: each day/)).toBeTruthy();
    expect(within(dialog).getAllByText('Observed activity').length).toBeGreaterThanOrEqual(3);
    expect(within(dialog).queryByText('Assumed activity')).toBeNull();
    expect(within(dialog).getByText(/Relevance and observed activity counted\./)).toBeTruthy();
  });
});

describe('RelevanceProofPanel matched dimensions', () => {
  const scenarioProof: RelevanceProof = {
    ...proof,
    relevance: {
      score: 0.5,
      country: { matched: true, matchedValue: 'France', organizationValue: 'France', claims: [] },
      sector: { matched: false, matchedValue: null, organizationValue: 'Finance', claims: [] },
    },
  };

  it('names the scenario value a dimension missed, and lists what missed under the relevance', async () => {
    renderPanel(scenarioTarget, scenarioProof);

    expect(await screen.findByText('Sector: no match (scenario: Finance)')).toBeTruthy();
    expect(screen.getByText('Country: France')).toBeTruthy();
    expect(screen.getByText('No match on sector')).toBeTruthy();
  });

  it('falls back to a bare no match when the organization states no value', async () => {
    renderPanel(scenarioTarget, {
      ...scenarioProof,
      relevance: { ...scenarioProof.relevance!, sector: { ...scenarioProof.relevance!.sector, organizationValue: null } },
    });

    expect(await screen.findByText('Sector: no match')).toBeTruthy();
  });
});

describe('RelevanceProofPanel activity block', () => {
  it('words the actor\'s age on its observed date', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    renderPanel(scenarioTarget, { ...proof, lastObservedAt: thirtyDaysAgo });

    await waitFor(() => expect(screen.getByText('Observed activity')).toBeTruthy());

    expect(screen.getByText('last month')).toBeTruthy();
  });

  // A date beside a badge saying no observation exists is the defect this guards: the age is read
  // off the observed date, never the blended anchor.
  it('shows no age at all beside a never-observed actor', async () => {
    renderPanel(scenarioTarget, { ...proof, lastObservedAt: null });

    await waitFor(() => expect(screen.getByText('Observed activity')).toBeTruthy());

    expect(screen.getByText('Not dated')).toBeTruthy();
  });

  it('names the attributed threat the date comes from, linked to its page', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    renderPanel(scenarioTarget, {
      ...proof,
      lastObservedAt: thirtyDaysAgo,
      lastObservedVia: { id: 'campaign-1', name: 'Operation Gilded Checkout' },
    });

    const link = await screen.findByRole('link', { name: 'Operation Gilded Checkout' });

    expect(link.getAttribute('href')).toBe('/threats/campaign-1');
    expect(link.parentElement?.textContent).toBe('via Operation Gilded Checkout');
  });

  it('says nothing of a source when the threat\'s own date is the latest', async () => {
    renderPanel(scenarioTarget, { ...proof, lastObservedAt: new Date().toISOString(), lastObservedVia: null });

    await waitFor(() => expect(screen.getByText('Observed activity')).toBeTruthy());

    expect(screen.queryByText(/^via/)).toBeNull();
  });
});
