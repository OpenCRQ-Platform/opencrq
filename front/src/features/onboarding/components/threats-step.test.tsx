/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ThreatsStep } from './threats-step';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#step">{children}</a>,
  useMatches: () => [],
  useParams: () => ({ tenantId: '89c70e9a-8317-4da7-8765-1b9ba004c32c' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

// The tiles' own reads stay loading: this suite is about the tenant count and the warning above them.
const renderStep = (threats: 'not_linked' | 'no_account' | 'unavailable' | null) => renderWithTrpc(<ThreatsStep />, {
  answers: {
    'threats.list': { items: [], total: 2, page: 1, limit: 1, pending: 0 },
    'xtm.readerAccess': { threats, counterparts: { opencti: null, openaev: null } },
    'onboardingWizard.getOnboardingWizard': NEVER,
    'connectors.listConnectors': NEVER,
    'opencti.getBackfillProgress': NEVER,
    'defaultThreats.getOverview': NEVER,
    'fileStorage.getSettings': NEVER,
  },
});

describe('ThreatsStep', () => {
  it('says above the sources why threats are hidden, by the reader\'s issue', async () => {
    renderStep('not_linked');

    expect(await screen.findByText('Some threats are hidden until OpenCTI is linked.')).toBeTruthy();
  });

  it('shows no warning when the reader lacks no threat', async () => {
    renderStep(null);

    expect(await screen.findByText('Threat sources')).toBeTruthy();
    await screen.findAllByText(/2 threats/);
    expect(screen.queryByText(/Some threats are hidden/)).toBeNull();
  });
});
