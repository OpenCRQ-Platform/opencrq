/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { CrqSimulationResults } from './crq-simulation-results';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

const SCOPE_ID = '00000000-0000-0000-0000-0000000000aa';

const renderResults = (scope: { estateMode: string, mappedAssetCount: number, noMappedAsset: boolean }) => {
  const answers = {
    'crqIndicators.getLatestRun': null,
    'organizations.getOrganization': { id: SCOPE_ID, name: 'Acme Lending', ...scope },
    'crqIndicators.getRunWithScores': null,
  };

  return renderWithTrpc(
    createElement(CrqSimulationResults, { riskScenarioId: 'scenario-1', organizationId: SCOPE_ID }),
    { answers },
  );
};

describe('CrqSimulationResults', () => {
  it('reads Not priced with its reason when the scope maps nothing', async () => {
    renderResults({ estateMode: 'closed', mappedAssetCount: 0, noMappedAsset: true });

    await waitFor(() => expect(screen.getByText(/Not priced: no mapped asset/)).toBeTruthy());
  });

  it('sends the reader to the asset mapping of the scope', async () => {
    renderResults({ estateMode: 'closed', mappedAssetCount: 0, noMappedAsset: true });

    await waitFor(() => expect(screen.getByText('Manage assets')).toBeTruthy());
    fireEvent.click(screen.getByText('Manage assets'));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate.mock.calls[0][0]).toMatchObject({ search: { scopeDrawerTab: 'estate' } });
  });

  it('asks for a run instead when the scope has an estate to price', async () => {
    renderResults({ estateMode: 'closed', mappedAssetCount: 12, noMappedAsset: false });

    await waitFor(() => expect(screen.getByText(/No simulation has been run yet/)).toBeTruthy());
    expect(screen.queryByText('Manage assets')).toBeNull();
  });
});
