/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { RequirementDrawer } from './requirement-drawer';

const ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000o1';
const ASSET = { id: '00000000-0000-0000-0000-0000000000a1', name: 'Securities Trading Process' };
const DRIVER = { id: '00000000-0000-0000-0000-0000000000d1', name: 'Contractual penalties' };

const REQUIREMENT = {
  id: '00000000-0000-0000-0000-0000000000r1',
  organizationId: ORGANIZATION_ID,
  name: 'Trading platform availability commitment',
  description: null,
  interestedParty: 'Northwind',
  protectsConfidentiality: false,
  protectsIntegrity: false,
  protectsAvailability: true,
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
  primaryAssets: [ASSET],
  businessValueCategories: [],
  lossDrivers: [DRIVER],
};

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

const renderDrawer = (getRequirement: () => typeof REQUIREMENT) => renderWithTrpc(
  <RequirementDrawer organizationId={ORGANIZATION_ID} requirement={REQUIREMENT} open onClose={() => {}} />,
  {
    answers: {
      'requirements.getRequirement': getRequirement,
      'primaryAssets.getPrimaryAssets': [ASSET],
      'businessValueCategories.getBusinessValueCategories': [],
      'lossDrivers.getLossDrivers': [DRIVER],
    },
  },
);

describe('RequirementDrawer', () => {
  it('should open a stored requirement prefilled, its targets and loss drivers included', async () => {
    renderDrawer(() => REQUIREMENT);

    expect((await screen.findByDisplayValue('Trading platform availability commitment')).tagName).toBe('INPUT');
    expect(screen.getByDisplayValue('Northwind')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Availability' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Integrity' }).getAttribute('aria-checked')).toBe('false');
    expect(await screen.findByText('Securities Trading Process')).toBeTruthy();
    expect(await screen.findByText('Contractual penalties')).toBeTruthy();
  });

  it('should take a refetched version of the requirement it opened from a stale copy', async () => {
    let stored = REQUIREMENT;
    renderDrawer(() => stored);
    await screen.findByDisplayValue('Northwind');

    stored = { ...REQUIREMENT, interestedParty: 'Northwind (key customer)' };
    // A window focus refetches every stale active query, as the doorbell does after a save.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(await screen.findByDisplayValue('Northwind (key customer)')).toBeTruthy();
  });
});
