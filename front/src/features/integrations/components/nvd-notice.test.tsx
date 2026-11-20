/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NVD_NOTICE, NvdNotice } from './nvd-notice';

const OFFICIAL_SENTENCE = 'This product uses the NVD API but is not endorsed or certified by the NVD.';

afterEach(() => {
  cleanup();
});

describe('NvdNotice', () => {
  it('should show the sentence of the NVD terms, word for word', () => {
    render(<NvdNotice />);

    expect(screen.getByText(OFFICIAL_SENTENCE).textContent).toBe(OFFICIAL_SENTENCE);
    expect(NVD_NOTICE).toBe(OFFICIAL_SENTENCE);
  });

  it('should mark the sentence as English for screen readers', () => {
    render(<NvdNotice />);

    expect(screen.getByText(OFFICIAL_SENTENCE).getAttribute('lang')).toBe('en');
  });

  it('should stay out of the translation catalogues', () => {
    for (const locale of ['en', 'fr']) {
      const catalogue = readFileSync(resolve(process.cwd(), 'src/locales', locale, 'messages.po'), 'utf8');

      expect(catalogue).not.toContain(OFFICIAL_SENTENCE);
    }
  });
});
