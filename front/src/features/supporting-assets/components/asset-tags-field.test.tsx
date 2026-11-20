/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { FunctionComponent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AssetTagOption } from './asset-tags-form-utils';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { AssetTagsField } from './asset-tags-field';
import { assetTagsFormValuesFrom } from './asset-tags-form-utils';

type AssetTagsFormFields = { tags: Array<AssetTagOption> };

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const Harness: FunctionComponent<{ initialTags: Array<AssetTagOption> }> = ({ initialTags }) => {
  const form = useForm<AssetTagsFormFields>({ defaultValues: { tags: initialTags } });
  const tags = useWatch({ control: form.control, name: 'tags' });
  return (
    <>
      <AssetTagsField control={form.control} />
      <output data-testid="tags">{tags.map((tag) => tag.name).join(',')}</output>
    </>
  );
};

const renderField = async (initialTags: Array<AssetTagOption>, vocabulary: Array<AssetTagOption>) => {
  const rendered = renderWithTrpc(<Harness initialTags={initialTags} />, { answers: { 'supportingAssets.listTags': vocabulary } });
  await waitFor(() => expect(rendered.queryClient.isFetching()).toBe(0));
  return rendered;
};

describe('AssetTagsField', () => {
  it('should render the asset existing tags as chips', async () => {
    await renderField([{ id: 'tag-1', name: 'production', color: null }], []);

    expect(screen.getAllByText('production').length).toBeGreaterThan(0);
  });

  it('should let a name typed in the input be created and selected', async () => {
    await renderField([], [{ id: 'tag-1', name: 'production', color: null }]);

    const input = screen.getByRole('combobox', { name: 'Your tags' });
    fireEvent.change(input, { target: { value: 'brand-new-tag' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('tags').textContent).toBe('brand-new-tag');
  });

  it('should let an existing vocabulary entry be picked by typing its exact name', async () => {
    await renderField([], [{ id: 'tag-1', name: 'production', color: null }]);

    const input = screen.getByRole('combobox', { name: 'Your tags' });
    fireEvent.change(input, { target: { value: 'production' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('tags').textContent).toBe('production');
  });

  it('should keep two tags whose names differ only by case apart', async () => {
    await renderField(
      [{ id: 'tag-1', name: 'production', color: null }],
      [{ id: 'tag-2', name: 'Production', color: null }, { id: 'tag-1', name: 'production', color: null }],
    );

    const input = screen.getByRole('combobox', { name: 'Your tags' });
    fireEvent.change(input, { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('option', { name: 'Production' }));

    expect(screen.getByTestId('tags').textContent).toBe('production,Production');
  });

  it('should not offer a connector-reported tag for prefill, only the manual author\'s own', async () => {
    const assetTags = [
      { id: 'tag-1', name: 'Critical', color: null, isManual: false },
      { id: 'tag-2', name: 'PCI', color: null, isManual: true },
    ];
    await renderField(assetTagsFormValuesFrom(assetTags), []);

    expect(screen.getByTestId('tags').textContent).toBe('PCI');
    expect(screen.queryByText('Critical')).toBeNull();
  });
});
