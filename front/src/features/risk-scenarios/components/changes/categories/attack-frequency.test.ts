import type { ChangeEvent } from '@app/module/client';
import { i18n } from '@lingui/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { attackFrequencyView } from './attack-frequency';

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const readEvent = (key: string, sentenceKey: string, parts: ChangeEvent['sentence']['parts']): ChangeEvent => ({
  category: 'attack-frequency',
  moment: { kind: 'recorded', at: '2026-11-17T00:00:00.000Z' },
  direction: 'none',
  item: { kind: 'tef-read', key, label: null, link: { kind: 'scenario-tab', tab: 'threat' } },
  sentence: { key: sentenceKey, parts },
  values: null,
});
const catalogueEvent = (parts: ChangeEvent['sentence']['parts']): ChangeEvent => readEvent('catalogue', 'tef-catalogue-changed', parts);

describe('attackFrequencyView', () => {
  it('names a multiplier vintage in the reader\'s language and a package by its id and version', () => {
    expect(attackFrequencyView.sentence?.(catalogueEvent({ beforeVintage: 2, after: 'opencrq-open-data 1.0.0' })))
      .toBe('The TEF is now read from catalog opencrq-open-data 1.0.0, it was catalog vintage 2');
  });

  it('names two packages by their ids and versions', () => {
    expect(attackFrequencyView.sentence?.(catalogueEvent({ before: 'another-catalogue 2.0.0', after: 'opencrq-open-data 1.0.0' })))
      .toBe('The TEF is now read from catalog opencrq-open-data 1.0.0, it was another-catalogue 2.0.0');
  });

  it('names a read with no size declared as such', () => {
    const event = readEvent('size', 'tef-size-changed', { before: '', after: '10-49, 50-249', beforeSource: 'none', afterSource: 'revenue_band' });
    expect(attackFrequencyView.sentence?.(event))
      .toBe('The TEF is now read for size class 10-49, 50-249 (from the revenue band), it was none (no size declared)');
  });
});
