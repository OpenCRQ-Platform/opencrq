/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UnscoredFindingSentence } from './finding-score-section';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderTranslated = (ui: ReactElement) => render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

describe('UnscoredFindingSentence', () => {
  it('should say NVD holds no usable record of a pending finding\'s CVE once a pass found none', () => {
    renderTranslated(<UnscoredFindingSentence pendingVector nvdRecordMissing />);

    expect(screen.getByText(/NVD holds no usable record of its CVE/)).toBeTruthy();
    expect(screen.queryByText(/pending a vector/)).toBeNull();
  });

  it('should promise the vector of a pending finding NVD was not found lacking', () => {
    renderTranslated(<UnscoredFindingSentence pendingVector nvdRecordMissing={false} />);

    expect(screen.getByText(/pending a vector/)).toBeTruthy();
    expect(screen.queryByText(/no usable record/)).toBeNull();
  });

  it('should wait for the recompute on a finding not pending a vector', () => {
    renderTranslated(<UnscoredFindingSentence pendingVector={false} nvdRecordMissing />);

    expect(screen.getByText(/has not been scored yet/)).toBeTruthy();
    expect(screen.queryByText(/no usable record/)).toBeNull();
  });
});
