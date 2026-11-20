/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FunctionComponent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AssetCategory, AssetSubcategory } from '@app/module/client';
import type { AssetPropertiesFormFields } from './asset-category-fields';
import { AssetCategoryFields } from './asset-category-fields';
import { emptyAssetPropertiesFormValues } from './asset-properties-form-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

interface HarnessProps {
  initialCategoryId: AssetCategory,
  initialSubcategoryId?: AssetSubcategory | null,
  existingUrl?: string | null,
  existingLinkedPerson?: string | null,
}

const Harness: FunctionComponent<HarnessProps> = (props) => {
  const initialSubcategoryId = props.initialSubcategoryId ?? null;
  const existingUrl = props.existingUrl ?? null;
  const existingLinkedPerson = props.existingLinkedPerson ?? null;
  const form = useForm<AssetPropertiesFormFields>({
    defaultValues: {
      categoryId: props.initialCategoryId,
      subcategoryId: initialSubcategoryId,
      url: null,
      linkedPerson: null,
      properties: emptyAssetPropertiesFormValues,
    },
  });
  const subcategoryId = useWatch({ control: form.control, name: 'subcategoryId' });
  return (
    <>
      <button type="button" onClick={() => form.setValue('categoryId', 'ai_target')}>
        switch to AI target
      </button>
      <button type="button" onClick={() => form.setValue('categoryId', 'host')}>
        switch to host
      </button>
      <AssetCategoryFields
        control={form.control}
        setValue={form.setValue}
        existingUrl={existingUrl}
        existingLinkedPerson={existingLinkedPerson}
      />
      <output data-testid="subcategoryId">{subcategoryId ?? ''}</output>
    </>
  );
};

describe('AssetCategoryFields', () => {
  it('should render the network and cloud fields for a machine-family category', () => {
    render(<Harness initialCategoryId="host" />);

    expect(screen.queryByText('Hostname')).not.toBeNull();
    expect(screen.queryByText('Cloud provider')).not.toBeNull();
    expect(screen.queryByText('Provider')).toBeNull();
  });

  it('should render the vendor and model fields for a machine-family category, and not for an AI target', () => {
    const { unmount } = render(<Harness initialCategoryId="host" />);

    expect(screen.queryByText('Vendor')).not.toBeNull();
    expect(screen.queryByText('Model')).not.toBeNull();

    unmount();
    render(<Harness initialCategoryId="ai_target" />);

    expect(screen.queryByText('Vendor')).toBeNull();
  });

  it('should render the AI target connection fields for the ai_target category', () => {
    render(<Harness initialCategoryId="ai_target" />);

    expect(screen.queryByText('Provider')).not.toBeNull();
    expect(screen.queryByText('Model')).not.toBeNull();
    expect(screen.queryByText('Hostname')).toBeNull();
  });

  it('should replace the network fields with AI target fields when the category select changes', () => {
    render(<Harness initialCategoryId="host" />);

    expect(screen.queryByText('Hostname')).not.toBeNull();
    expect(screen.queryByText('Provider')).toBeNull();

    fireEvent.click(screen.getByText('switch to AI target'));

    expect(screen.queryByText('Hostname')).toBeNull();
    expect(screen.queryByText('Provider')).not.toBeNull();
  });

  it('should render the Identity card\'s fields for the identity category, the directory\'s identifiers aside', () => {
    render(<Harness initialCategoryId="identity" />);

    expect(screen.queryByText('User principal name')).not.toBeNull();
    expect(screen.queryByText('Directory')).not.toBeNull();
    expect(screen.queryByText('Directory roles')).not.toBeNull();
    expect(screen.queryByText('Cloud SID')).toBeNull();
    expect(screen.queryByText('On-premises SID')).toBeNull();
    expect(screen.queryByText('Hostname')).toBeNull();
    expect(screen.queryByText('Provider')).toBeNull();
  });

  it('should render nothing for the generic_asset category', () => {
    render(<Harness initialCategoryId="generic_asset" />);

    expect(screen.queryByText('Hostname')).toBeNull();
    expect(screen.queryByText('Provider')).toBeNull();
  });

  it('should clear a subcategory that no longer belongs to the newly selected category', () => {
    render(<Harness initialCategoryId="host" initialSubcategoryId="server" />);

    expect(screen.getByTestId('subcategoryId').textContent).toBe('server');

    fireEvent.click(screen.getByText('switch to AI target'));

    expect(screen.getByTestId('subcategoryId').textContent).toBe('');
  });

  it('should keep a subcategory that still belongs to the newly selected category', () => {
    render(<Harness initialCategoryId="host" initialSubcategoryId="server" />);

    fireEvent.click(screen.getByText('switch to host'));

    expect(screen.getByTestId('subcategoryId').textContent).toBe('server');
  });

  it('should show the URL field on web_application', () => {
    render(<Harness initialCategoryId="web_application" />);

    expect(screen.queryByText('URL')).not.toBeNull();
  });

  it('should not show the URL field on host with no existing value', () => {
    render(<Harness initialCategoryId="host" />);

    expect(screen.queryByText('URL')).toBeNull();
  });

  it('should show the URL field on host when the asset already carries one', () => {
    render(<Harness initialCategoryId="host" existingUrl="https://example.com" />);

    expect(screen.queryByText('URL')).not.toBeNull();
  });

  it('should show the Person field on identity', () => {
    render(<Harness initialCategoryId="identity" />);

    expect(screen.queryByText('Person')).not.toBeNull();
  });

  it('should not show the Person field on host with no existing value', () => {
    render(<Harness initialCategoryId="host" />);

    expect(screen.queryByText('Person')).toBeNull();
  });

  it('should show the Person field on host when the asset already carries one', () => {
    render(<Harness initialCategoryId="host" existingLinkedPerson="Jane Doe" />);

    expect(screen.queryByText('Person')).not.toBeNull();
  });
});
