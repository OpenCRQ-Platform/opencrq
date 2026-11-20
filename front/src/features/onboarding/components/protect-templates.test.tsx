/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProtectTemplateKey } from '../protect-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ProtectTemplates } from './protect-templates';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('../../primary-assets', () => ({
  PrimaryAssetCreateSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog">Create a new primary asset</div> : null),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const CATEGORIES = [
  { id: '00000000-0000-4000-8000-000000000001', code: 'personal-data', name: 'Personal data', description: '', displayOrder: 4 },
  { id: '00000000-0000-4000-8000-000000000002', code: 'own-funds-and-payment-authority', name: 'Own funds and payment authority', description: '', displayOrder: 8 },
  { id: '00000000-0000-4000-8000-000000000003', code: 'operations-and-services', name: 'Operations and services', description: '', displayOrder: 1 },
  { id: '00000000-0000-4000-8000-000000000004', code: 'proprietary-information', name: 'Proprietary information', description: '', displayOrder: 6 },
];

type TestAsset = { id: string, name: string, onboardingTemplate: ProtectTemplateKey | null };

const renderTemplates = (assets: Array<TestAsset> = [], onLink = vi.fn()) => ({
  onLink,
  ...renderWithTrpc(<ProtectTemplates organizationId="scope-id" assets={assets} onLink={onLink} />, {
    answers: { 'businessValueCategories.getBusinessValueCategories': CATEGORIES },
  }),
});

describe('ProtectTemplates', () => {
  it('offers the six templates with their category, and none added on an empty scope', async () => {
    renderTemplates();

    for (const name of ['Customer data', 'Payments and treasury', 'Production and operations', 'HR data', 'Intellectual property', 'Email and collaboration']) {
      expect(await screen.findByRole('button', { name })).toBeTruthy();
    }
    expect(await screen.findByText('Own funds and payment authority')).toBeTruthy();
    expect(screen.queryByText('Added')).toBeNull();
  });

  it('creates the primary asset on the scope with the category of the template, named as the card', async () => {
    const { calls } = renderTemplates();
    await screen.findByText('Own funds and payment authority');

    fireEvent.click(screen.getByRole('button', { name: 'Payments and treasury' }));

    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === 'primaryAssets.createPrimaryAsset')).toBe(true);
    });
    expect(calls.find((call) => call.path === 'primaryAssets.createPrimaryAsset')?.input).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      organizationId: 'scope-id',
      name: 'Payments and treasury',
      description: null,
      ownerId: null,
      businessValueCategoryIds: ['00000000-0000-4000-8000-000000000002'],
      onboardingTemplate: 'payments-and-treasury',
    });
  });

  it('shows a clicked card as adding until the list holds its asset, and lets the other cards create meanwhile', async () => {
    const { calls } = renderTemplates();
    await screen.findByText('Own funds and payment authority');
    const creates = () => calls.filter((call) => call.path === 'primaryAssets.createPrimaryAsset');

    fireEvent.click(screen.getByRole('button', { name: 'Customer data' }));
    await vi.waitFor(() => {
      expect(creates()).toHaveLength(1);
    });
    expect(screen.getByText('Adding…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Customer data' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Customer data' }));
    fireEvent.click(screen.getByRole('button', { name: 'HR data' }));

    await vi.waitFor(() => {
      expect(creates().map((call) => call.input)).toEqual([
        expect.objectContaining({ onboardingTemplate: 'customer-data' }),
        expect.objectContaining({ onboardingTemplate: 'hr-data' }),
      ]);
    });
  });

  it('shows "Added" with Link assets on a template whose primary asset exists, and links that asset', async () => {
    const { onLink } = renderTemplates([{ id: 'asset-1', name: 'HR data', onboardingTemplate: 'hr-data' }]);

    expect(await screen.findByText('Added')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Link assets' }));

    expect(onLink).toHaveBeenCalledWith({ id: 'asset-1', name: 'HR data' });
    expect(screen.queryByRole('button', { name: 'HR data' })).toBeNull();
  });

  it('still shows a template as added once its primary asset is renamed, and links it under its new name', async () => {
    const { onLink } = renderTemplates([{ id: 'asset-1', name: 'Clients and prospects', onboardingTemplate: 'customer-data' }]);

    expect(await screen.findByText('Added')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Customer data' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Link assets' }));

    expect(onLink).toHaveBeenCalledWith({ id: 'asset-1', name: 'Clients and prospects' });
  });

  it('offers a template again when the only primary asset under its name was created by hand', async () => {
    renderTemplates([{ id: 'asset-1', name: 'Customer data', onboardingTemplate: null }]);

    expect(await screen.findByRole('button', { name: 'Customer data' })).toBeTruthy();
    expect(screen.queryByText('Added')).toBeNull();
  });

  it('does not create a template again once it is added', async () => {
    const { calls } = renderTemplates([{ id: 'asset-1', name: 'Customer data', onboardingTemplate: 'customer-data' }]);
    await screen.findByText('Added');

    expect(screen.queryByRole('button', { name: 'Customer data' })).toBeNull();
    expect(calls.some((call) => call.path === 'primaryAssets.createPrimaryAsset')).toBe(false);
  });

  it('deletes the primary asset of an added template once the reader confirms', async () => {
    const { calls } = renderTemplates([{ id: 'asset-1', name: 'Clients', onboardingTemplate: 'customer-data' }]);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('This will permanently delete this primary asset and everything attached to it. This action cannot be undone.')).toBeTruthy();
    expect(calls.some((call) => call.path === 'primaryAssets.deletePrimaryAssets')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => {
      expect(calls.find((call) => call.path === 'primaryAssets.deletePrimaryAssets')?.input).toEqual(['asset-1']);
    });
  });

  it('deletes nothing when the reader cancels the confirmation', async () => {
    const { calls } = renderTemplates([{ id: 'asset-1', name: 'Clients', onboardingTemplate: 'customer-data' }]);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.some((call) => call.path === 'primaryAssets.deletePrimaryAssets')).toBe(false);
  });

  it('opens the primary asset create sheet on Add your own', async () => {
    renderTemplates();

    fireEvent.click(await screen.findByRole('button', { name: 'Add your own' }));

    expect(within(await screen.findByRole('dialog')).getByText('Create a new primary asset')).toBeTruthy();
  });
});
