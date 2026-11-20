/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AssetCriticalityChip } from './asset-chips';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

/** The feedback family a severity is painted from, which is what tells the two top bands apart. */
const familyOf = (markup: string): string | undefined =>
  /bg-feedback-(\w+)-secondary/.exec(markup)?.[1];

describe('AssetCriticalityChip', () => {
  it('paints the two top bands apart, the severer one on the error family', () => {
    const top = render(<AssetCriticalityChip criticality="very_high" />);
    expect(familyOf(top.container.innerHTML)).toBe('error');
    cleanup();

    const high = render(<AssetCriticalityChip criticality="high" />);
    expect(familyOf(high.container.innerHTML)).toBe('warning');
  });

  it('labels the new band', () => {
    const { container } = render(<AssetCriticalityChip criticality="very_high" />);
    expect(container.textContent).toBe('Very High');
  });
});
