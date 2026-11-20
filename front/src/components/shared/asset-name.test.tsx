/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AssetName } from './asset-name';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('AssetName', () => {
  it('renders a real name as plain text, with no explanation', () => {
    const { container } = render(<AssetName name="srv-01" derivedName="10.0.0.1" />);
    expect(container.textContent).toBe('srv-01');
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('renders a derived name with a title giving it in full and where it comes from', () => {
    const { container } = render(<AssetName name={null} derivedName="10.0.0.1" />);
    expect(container.textContent).toBe('10.0.0.1');
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe("10.0.0.1, name deduced from the asset's properties");
  });

  it('renders the unnamed label when the asset has no name at all', () => {
    const { container } = render(<AssetName name={null} derivedName={null} />);
    expect(container.textContent).toBe('Unnamed asset');
  });

  it('keeps the name and the derived name visually apart', () => {
    const named = render(<AssetName name="srv-01" derivedName={null} />).container.innerHTML;
    cleanup();
    const derived = render(<AssetName name={null} derivedName="10.0.0.1" />).container.innerHTML;
    expect(named).not.toContain('text-default-secondary');
    expect(derived).toContain('text-default-secondary');
  });
});
