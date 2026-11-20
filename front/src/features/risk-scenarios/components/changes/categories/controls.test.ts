import type { ChangeEvent } from '@app/module/client';
import { i18n } from '@lingui/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { controlsView } from './controls';

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const eventOf = (key: string, parts: ChangeEvent['sentence']['parts']): ChangeEvent => ({
  category: 'controls',
  moment: { kind: 'run', runId: 'after' },
  direction: 'up',
  item: { kind: 'control', key: 'edr/strength', label: 'EDR', link: { kind: 'control', controlId: 'edr' } },
  sentence: { key, parts },
  values: null,
});

const sentenceOf = (key: string, parts: ChangeEvent['sentence']['parts']): string | undefined => controlsView.sentence?.(eventOf(key, parts));

describe('controlsView', () => {
  it('names a strength and a coverage move by their labels', () => {
    expect(sentenceOf('strength-changed', { control: 'EDR', from: 'L3', to: 'L2' })).toBe('Strength of EDR went from Master to Intermediate');
    expect(sentenceOf('coverage-changed-on-scope', { control: 'EDR', from: 'L1', to: 'L2', scope: 'Production IS' }))
      .toBe('Coverage of EDR went from Partial to Broad on Production IS');
  });
});
