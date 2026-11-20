import type { ChangeGroup } from '@app/module/client';
import { i18n } from '@lingui/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages as frenchMessages } from '../../../../../locales/fr/messages.po';
import { criticalAssetsView, otherAssetsView } from './asset-posture';

const group = (overrides: Partial<ChangeGroup>): ChangeGroup => ({
  kind: 'first-measured',
  from: '2026-09-16T09:00:00.000Z',
  to: '2026-09-16T18:00:00.000Z',
  up: 0,
  down: 0,
  bands: [{ from: null, to: 'medium', count: 150 }, { from: null, to: 'low', count: 40 }, { from: null, to: null, count: 22 }],
  ...overrides,
});

const sentence = (overrides: Partial<ChangeGroup>) => otherAssetsView.groupSentence?.(group(overrides));

describe('other assets groups', () => {
  beforeEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  afterEach(() => {
    i18n.activate('en');
  });

  it('count the assets first measured, though they move the loss neither way, then split them by the posture they hold', () => {
    expect(sentence({})).toEqual({ headline: '212 assets measured for the first time', breakdown: '150 medium, 40 low, 22 with no posture' });
  });

  it('name the posture moves from the band left to the band reached, no posture included', () => {
    expect(sentence({
      kind: 'posture-moved',
      up: 51,
      down: 18,
      bands: [{ from: 'low', to: 'medium', count: 51 }, { from: 'medium', to: 'low', count: 17 }, { from: 'low', to: null, count: 1 }],
    })).toEqual({ headline: '69 assets changed posture', breakdown: '51 from Low to Medium, 17 from Medium to Low, 1 from Low to no posture' });
  });

  it('agree the French posture with the asset', () => {
    i18n.load('fr', frenchMessages);
    i18n.activate('fr');

    expect(sentence({})?.breakdown).toBe('150 moyens, 40 faibles, 22 sans posture');
  });
});

describe('critical assets groups', () => {
  beforeEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('count the assets that changed posture, then the band each left for Critical', () => {
    expect(criticalAssetsView.groupSentence?.(group({
      kind: 'posture-moved',
      up: 412,
      bands: [{ from: 'high', to: 'critical', count: 398 }, { from: 'medium', to: 'critical', count: 14 }],
    }))).toEqual({ headline: '412 assets changed posture', breakdown: '398 from High to Critical, 14 from Medium to Critical' });
  });
});
