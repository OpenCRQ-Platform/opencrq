/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrawerForm } from './drawer-form';
import { DrawerFormActions } from './drawer-form-actions';
import { FormDrawer } from './form-drawer';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

interface FormProps {
  onSubmit: (values: { name: string }) => void,
}

const Form = ({ onSubmit }: FormProps) => {
  const form = useForm({ defaultValues: { name: '' } });
  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions submitLabel="Create" />}
    >
      <input aria-label="name" {...form.register('name')} />
    </DrawerForm>
  );
};

describe('DrawerForm', () => {
  it('should submit the fields when the footer button is pressed', async () => {
    const onSubmit = vi.fn();
    render(
      <I18nProvider i18n={i18n}>
        <FormDrawer open title="Test drawer" onClose={() => {}}>
          <Form onSubmit={onSubmit} />
        </FormDrawer>
      </I18nProvider>,
    );

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Quarterly plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ name: 'Quarterly plan' });
  });
});
