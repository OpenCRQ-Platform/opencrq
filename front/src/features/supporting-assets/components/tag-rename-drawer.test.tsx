/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TrpcCall } from '../../../providers/trpc-test-harness';
import type { ManagedTag, TagRow } from './tag-management-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { TagRenameDrawer } from './tag-rename-drawer';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const managedTag = (id: string, name: string, mergedIntoTagId: string | null = null): ManagedTag => ({
  id,
  name,
  color: null,
  mergedIntoTagId,
  mergedAt: mergedIntoTagId === null ? null : '2026-10-02T10:00:00.000Z',
  assetCount: 1,
  sources: [{ kind: 'manual' }],
});

const ALPHA = managedTag('alpha-id', 'alpha');
const BETA = managedTag('beta-id', 'beta');
const LEGACY = managedTag('legacy-id', 'legacy', 'beta-id');
const OLD_ALPHA = managedTag('old-alpha-id', 'old-alpha', 'alpha-id');
const TAGS = [ALPHA, BETA, LEGACY, OLD_ALPHA];

const ROW: TagRow = { ...ALPHA, mergedTags: [OLD_ALPHA], connectorNames: [] };

const renderDrawer = () => renderWithTrpc(<TagRenameDrawer open onOpenChange={() => {}} tag={ROW} tags={TAGS} />);

const callsTo = (calls: Array<TrpcCall>, path: string) => calls.filter((call) => call.path === path);

const typeNameAndSave = (name: string) => {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
};

describe('TagRenameDrawer', () => {
  it('renames the tag when the typed name is free, and never merges', async () => {
    const { calls } = renderDrawer();

    typeNameAndSave('gamma');

    await waitFor(() => expect(callsTo(calls, 'supportingAssets.renameTag')).toHaveLength(1));
    expect(calls).toContainEqual(expect.objectContaining({ path: 'supportingAssets.renameTag', input: { tagId: 'alpha-id', name: 'gamma' } }));
    expect(callsTo(calls, 'supportingAssets.mergeTag')).toHaveLength(0);
  });

  it('offers to merge into the root when the name is held by a tag merged elsewhere, and renames nothing', async () => {
    const { calls } = renderDrawer();

    typeNameAndSave('legacy');

    const dialog = await screen.findByRole('dialog', { name: 'This name is already taken' });
    expect(dialog.textContent).toContain('“legacy” was merged into “beta”');
    expect(callsTo(calls, 'supportingAssets.renameTag')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(callsTo(calls, 'supportingAssets.mergeTag')).toHaveLength(1));
    expect(calls).toContainEqual(expect.objectContaining({ path: 'supportingAssets.mergeTag', input: { tagId: 'alpha-id', targetTagId: 'beta-id' } }));
    expect(callsTo(calls, 'supportingAssets.renameTag')).toHaveLength(0);
  });

  it('flags the field, without a dialog or a mutation, when the name is one of the tag\'s own merged tags', async () => {
    const { calls } = renderDrawer();

    typeNameAndSave('old-alpha');

    expect(await screen.findByText('This name is already taken.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'This name is already taken' })).toBeNull();
    expect(callsTo(calls, 'supportingAssets.renameTag')).toHaveLength(0);
    expect(callsTo(calls, 'supportingAssets.mergeTag')).toHaveLength(0);
  });
});
