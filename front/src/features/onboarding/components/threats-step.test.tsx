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
const renderStep = (readerScopeUnresolved: boolean) => renderWithTrpc(<ThreatsStep />, {
  answers: {
    'threats.list': { items: [], total: 2, page: 1, limit: 1, pending: 0, readerScopeUnresolved },
    'onboardingWizard.getOnboardingWizard': NEVER,
    'connectors.listConnectors': NEVER,
    'opencti.getBackfillProgress': NEVER,
    'defaultThreats.getOverview': NEVER,
    'fileStorage.getSettings': NEVER,
  },
});

describe('ThreatsStep', () => {
  it('warns above the sources that threats may be hidden when OpenCTI left the reader scope unresolved', async () => {
    renderStep(true);

    expect(await screen.findByText('Some threats may be hidden from you.')).toBeTruthy();
  });

  it('shows no warning once the reader scope is known', async () => {
    renderStep(false);

    expect(await screen.findByText('Threat sources')).toBeTruthy();
    await screen.findAllByText(/2 threats/);
    expect(screen.queryByText('Some threats may be hidden from you.')).toBeNull();
  });
});
