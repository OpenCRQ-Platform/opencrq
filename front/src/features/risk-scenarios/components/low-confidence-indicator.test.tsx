/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LowConfidenceIndicator } from './low-confidence-indicator';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderIndicator = (lowConfidence: boolean) => render(
  <I18nProvider i18n={i18n}>
    <LowConfidenceIndicator lowConfidence={lowConfidence} />
  </I18nProvider>,
);

describe('LowConfidenceIndicator', () => {
  it('renders nothing when the row is not flagged', () => {
    const { container } = renderIndicator(false);
    expect(container.innerHTML).toBe('');
  });

  it('renders an accessible warning marker when the row is flagged', () => {
    renderIndicator(true);
    expect(screen.getByRole('img')).toBeTruthy();
  });
});
