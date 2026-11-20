/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NVD_NOTICE } from './nvd-notice';
import { AboutPanel } from './connector-overview';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderPanel = (source: 'nist' | 'first') => render(
  <I18nProvider i18n={i18n}>
    <AboutPanel connector={{ source, domain: 'vulnerability', url: null }} description="What the connector does." />
  </I18nProvider>,
);

describe('AboutPanel', () => {
  it('should carry the NVD notice on the NVD connector', () => {
    renderPanel('nist');

    expect(screen.getByText(NVD_NOTICE)).toBeDefined();
  });

  it('should not carry it on another connector', () => {
    renderPanel('first');

    expect(screen.queryByText(NVD_NOTICE)).toBeNull();
  });
});
