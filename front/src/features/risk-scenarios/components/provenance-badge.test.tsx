/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProvenanceBadge } from './provenance-badge';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderBadge = (provenance: 'manual' | 'questionnaire') => render(
  <I18nProvider i18n={i18n}>
    <ProvenanceBadge provenance={provenance} />
  </I18nProvider>,
);

describe('ProvenanceBadge', () => {
  it('labels a questionnaire-derived row as Auto', () => {
    renderBadge('questionnaire');
    expect(screen.getByText('Auto')).toBeTruthy();
  });

  it('labels a manual row as Manual', () => {
    renderBadge('manual');
    expect(screen.getByText('Manual')).toBeTruthy();
  });
});
