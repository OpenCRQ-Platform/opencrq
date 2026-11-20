import type { ChangeGroup } from '@app/module/client';
import { i18n } from '@lingui/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages as frenchMessages } from '../../../../../locales/fr/messages.po';
import { highFindingsView, otherFindingsView } from './findings';

const group = (overrides: Partial<ChangeGroup>): ChangeGroup => ({
  kind: 'appeared',
  from: '2026-10-03T09:00:00.000Z',
  to: '2026-10-03T18:00:00.000Z',
  up: 15_230,
  down: 0,
  bands: [{ from: null, to: 'medium', count: 11_870 }, { from: null, to: 'low', count: 3_360 }],
  ...overrides,
});

const sentence = (overrides: Partial<ChangeGroup>) => otherFindingsView.groupSentence?.(group(overrides));

describe('other findings groups', () => {
  beforeEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  afterEach(() => {
    i18n.activate('en');
  });

  it('count the CVEs that appeared, then split them by the band they reached', () => {
    expect(sentence({})).toEqual({ headline: '15,230 CVEs appeared', breakdown: '11,870 medium, 3,360 low' });
  });

  it('name the band moves from the band left to the band reached', () => {
    expect(sentence({
      kind: 'band-moved',
      up: 38,
      down: 7,
      bands: [{ from: 'low', to: 'medium', count: 38 }, { from: 'medium', to: 'low', count: 7 }],
    })).toEqual({ headline: '45 CVEs changed band', breakdown: '38 from Low to Medium, 7 from Medium to Low' });
  });

  it('count a CVE with no band apart', () => {
    expect(sentence({ kind: 'left', up: 0, down: 2, bands: [{ from: null, to: null, count: 2 }] })).toEqual({
      headline: '2 CVEs no longer apply',
      breakdown: '2 with no band',
    });
  });

  it('count the CVEs their connectors stopped reporting apart from those that no longer apply', () => {
    expect(sentence({ kind: 'no-longer-reported', up: 0, down: 3, bands: [{ from: 'medium', to: null, count: 3 }] })).toEqual({
      headline: '3 CVEs no longer reported',
      breakdown: '3 medium',
    });
  });

  it('agree the French band with the CVE and group the digits of every count', () => {
    i18n.load('fr', frenchMessages);
    i18n.activate('fr');

    expect(sentence({})).toEqual({ headline: '15 230 CVE apparues', breakdown: '11 870 moyennes, 3 360 faibles' });
  });
});

describe('high findings groups', () => {
  beforeEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('name the bands a CVE moved from into High', () => {
    expect(highFindingsView.groupSentence?.(group({
      kind: 'band-moved',
      up: 7,
      bands: [{ from: 'medium', to: 'high', count: 5 }, { from: 'low', to: 'high', count: 2 }],
    }))).toEqual({ headline: '7 CVEs changed band', breakdown: '5 from Medium to High, 2 from Low to High' });
  });

  it('leave out a breakdown that would only repeat the tile\'s band', () => {
    expect(highFindingsView.groupSentence?.(group({ up: 9, bands: [{ from: null, to: 'high', count: 9 }] })))
      .toEqual({ headline: '9 CVEs appeared', breakdown: '' });
  });
});
