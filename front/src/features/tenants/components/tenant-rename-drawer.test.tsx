/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TrpcCall } from '../../../providers/trpc-test-harness';
import { FAILED, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { TenantRenameDrawer } from './tenant-rename-drawer';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const TENANT = { id: 'tenant-id', name: 'Acme' };

const renderDrawer = (answers: Record<string, unknown> = {}) => {
  const onRenamed = vi.fn();
  const onOpenChange = vi.fn();
  const rendered = renderWithTrpc(
    <TenantRenameDrawer open onOpenChange={onOpenChange} tenant={TENANT} onRenamed={onRenamed} />,
    { answers },
  );
  return { ...rendered, onRenamed, onOpenChange };
};

const callsTo = (calls: Array<TrpcCall>, path: string) => calls.filter((call) => call.path === path);

const typeNameAndSave = (name: string) => {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
};

describe('TenantRenameDrawer', () => {
  it('shows the current name in the field', () => {
    renderDrawer();

    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Acme');
  });

  it('renames with the trimmed name, then reports it', async () => {
    const { calls, onRenamed } = renderDrawer();

    typeNameAndSave('  Globex  ');

    await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(1));
    expect(callsTo(calls, 'tenants.renameTenant')).toHaveLength(1);
    expect(calls).toContainEqual(expect.objectContaining({ path: 'tenants.renameTenant', input: { id: 'tenant-id', name: 'Globex' } }));
  });

  it('closes without a call when the name is unchanged', async () => {
    const { calls, onRenamed, onOpenChange } = renderDrawer();

    typeNameAndSave('  Acme ');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(callsTo(calls, 'tenants.renameTenant')).toHaveLength(0);
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it('refuses a blank name without a call', async () => {
    const { calls, onRenamed } = renderDrawer();

    typeNameAndSave('   ');

    expect(await screen.findByText('Enter a name.')).toBeTruthy();
    expect(screen.getByLabelText(/^Name/).getAttribute('aria-invalid')).toBe('true');
    expect(callsTo(calls, 'tenants.renameTenant')).toHaveLength(0);
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it('does not report a rename the server refused', async () => {
    const { calls, onRenamed } = renderDrawer({ 'tenants.renameTenant': FAILED });

    typeNameAndSave('Globex');

    await waitFor(() => expect(callsTo(calls, 'tenants.renameTenant')).toHaveLength(1));
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
