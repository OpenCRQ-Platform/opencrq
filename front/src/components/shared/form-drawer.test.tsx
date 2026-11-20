/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DrawerForm } from './drawer-form';
import { FormDrawer, useFormDrawerNavigationGuard } from './form-drawer';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const GuardedForm = () => {
  useFormDrawerNavigationGuard();
  const { history } = useRouter();
  const form = useForm({ defaultValues: { name: '' } });
  return (
    <DrawerForm form={form} onSubmit={() => {}}>
      <input aria-label="name" {...form.register('name')} />
      <button type="button" onClick={() => history.push('/other')}>Other page</button>
    </DrawerForm>
  );
};

const rootRoute = createRootRoute();
const drawerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <FormDrawer open title="Test drawer" onClose={() => {}}>
      <GuardedForm />
    </FormDrawer>
  ),
});
const otherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/other',
  component: () => <div data-testid="other">other</div>,
});
const routeTree = rootRoute.addChildren([drawerRoute, otherRoute]);

const renderDrawer = async () => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<I18nProvider i18n={i18n}><RouterProvider router={router} /></I18nProvider>);
  await act(() => router.load());
  return router;
};

describe('useFormDrawerNavigationGuard', () => {
  it('should navigate at once when the form is clean', async () => {
    await renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Other page' }));

    await waitFor(() => expect(screen.getByTestId('other')).toBeTruthy());
  });

  it('should hold a navigation behind the discard dialog when the form is dirty, and stay on Cancel', async () => {
    const router = await renderDrawer();

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Quarterly plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Other page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByLabelText<HTMLInputElement>('name').value).toBe('Quarterly plan');
  });

  it('should complete the held navigation once the changes are discarded', async () => {
    await renderDrawer();

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Quarterly plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Other page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.getByTestId('other')).toBeTruthy());
  });
});
