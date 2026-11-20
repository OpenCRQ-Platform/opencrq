/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MultiSelectField, SingleSelectField } from './select-field';

const OPTIONS = [{ label: 'France', value: 'FRA' }, { label: 'Germany', value: 'DEU' }];

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const expectIgnoredByPasswordManagers = (input: HTMLElement) => {
  expect(input.hasAttribute('data-1p-ignore')).toBe(true);
  expect(input.hasAttribute('data-bwignore')).toBe(true);
  expect(input.getAttribute('data-lpignore')).toBe('true');
};

describe('SelectField', () => {
  it('should keep password managers off a single select labelled like an address field', () => {
    render(<SingleSelectField label="Country" options={OPTIONS} value={null} onChange={() => {}} hideLabel />);

    expectIgnoredByPasswordManagers(screen.getByRole('combobox', { name: 'Country' }));
  });

  it('should keep password managers off a multiple select', () => {
    render(<MultiSelectField label="Countries" options={OPTIONS} value={[]} onChange={() => {}} hideLabel />);

    expectIgnoredByPasswordManagers(screen.getByRole('combobox', { name: 'Countries' }));
  });
});
