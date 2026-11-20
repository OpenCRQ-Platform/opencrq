/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SourceStack } from './source-stack';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('SourceStack', () => {
  it('shows a connector once when several of its sources report the asset', () => {
    const { container } = render(<SourceStack sources={['openaev', 'microsoft_graph', 'openaev']} />);
    expect([...container.querySelectorAll('[title]')].map((mark) => mark.getAttribute('title')))
      .toEqual(['OpenAEV', 'Microsoft Defender']);
  });

  it('shows the person glyph when nothing reports it', () => {
    const { container } = render(<SourceStack sources={[]} />);
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('Set by user');
  });
});
