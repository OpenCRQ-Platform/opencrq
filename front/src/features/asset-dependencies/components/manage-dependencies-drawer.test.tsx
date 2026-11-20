/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LinkDelta } from '../manage-dependencies-utils';
import type { SupportingCandidateRow } from './supporting-asset-candidates';
import { FAILED, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { ManagePrimaryAssetDependenciesDrawer } from './manage-dependencies-drawer';

const toast = vi.fn();
const release = vi.fn();
const holdDoorbells = vi.fn(() => release);

vi.mock('@filigran/ui', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useToast: () => ({ toast }),
}));

vi.mock('../../../providers/event-stream-provider', () => ({
  useHoldDoorbells: () => holdDoorbells,
}));

const row: SupportingCandidateRow = { id: 'asset-1', name: 'Mail server', derivedName: null, categoryId: 'host', exposure: 'internal', criticality: 'high', sources: [] };
const added: LinkDelta<SupportingCandidateRow> = { [row.id]: { kind: 'add', row, roles: ['stores'] } };

vi.mock('./supporting-asset-candidates', () => ({
  SupportingAssetCandidates: ({ onDeltaChange }: { onDeltaChange: (delta: LinkDelta<SupportingCandidateRow>) => void }) => (
    <button type="button" onClick={() => onDeltaChange(added)}>Link the mail server</button>
  ),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const deferred = <T extends object>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const listIsInert = () => screen.getByRole('button', { name: 'Link the mail server', hidden: true }).closest('[inert]') !== null;

/** Opens the drawer once its stored links loaded, stages one link and saves; `createLinks` is what the server answers the save with. */
const renderDrawer = async (createLinks: unknown) => {
  const onClose = vi.fn();
  const { calls } = renderWithTrpc(
    <ManagePrimaryAssetDependenciesDrawer open onClose={onClose} primaryAssetId="primary-1" primaryAssetName="Payroll" />,
    {
      answers: {
        'assetDependencies.getSupportToPrimaryLinksByPrimaryAssetId': [],
        'assetDependencies.createSupportToPrimaryLinks': createLinks,
      },
    },
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Link the mail server' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
  return { onClose, calls };
};

describe('ManagePrimaryAssetDependenciesDrawer', () => {
  it('should hold the page refreshes until the save settles, then close behind one toast', async () => {
    const call = deferred<{ skippedIds: Array<string>, goneIds: Array<string> }>();
    const { onClose } = await renderDrawer(call.promise);

    expect(holdDoorbells).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    call.resolve({ skippedIds: [], goneIds: [] });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(release).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ description: '1 dependency change saved.' });
  });

  it('should release the page refreshes when the save fails, and keep the change pending', async () => {
    const { onClose } = await renderDrawer(FAILED);

    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save 1 change' })).toBeTruthy();
  });

  it('should drop a link whose asset was deleted meanwhile, and say so instead of a saved toast', async () => {
    const { onClose } = await renderDrawer((links: Array<{ id: string }>) => ({ skippedIds: [], goneIds: links.map((link) => link.id) }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ description: '1 link was not created, as its asset was deleted in the meantime.', variant: 'info' });
  });

  it('should keep the list out of reach while the save runs, and give it back when the save fails', async () => {
    const call = deferred<{ skippedIds: Array<string>, goneIds: Array<string> }>();
    await renderDrawer(call.promise);

    expect(listIsInert()).toBe(true);

    call.reject(new Error('unavailable'));

    await waitFor(() => expect(listIsInert()).toBe(false));
  });
});
