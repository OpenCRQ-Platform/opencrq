/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RunCount } from './run-count';

beforeAll(() => {
  i18n.load({ en: {}, fr: {} });
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  i18n.activate('en');
});

describe('RunCount', () => {
  it('draws a count under a thousand exactly, with no hint to open', () => {
    render(<RunCount value={999} />);

    const count = screen.getByText('999');
    expect(count.getAttribute('tabindex')).toBeNull();
  });

  it('draws a count from a thousand compact, focusable for its exact value', () => {
    render(<RunCount value={123_456_789} />);

    const count = screen.getByText('123.5M');
    expect(count.getAttribute('tabindex')).toBe('0');
    expect(screen.queryByText('123,456,789')).toBeNull();
  });

  it('writes the compact count as the application language does', () => {
    i18n.activate('fr');
    render(<RunCount value={2_147_483_647} />);

    expect(screen.getByText(/^2,1\s?Md$/u)).toBeTruthy();
  });
});
