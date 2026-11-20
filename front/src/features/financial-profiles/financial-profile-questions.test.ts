import { LOSS_DRIVERS, QUESTION_IDS } from '@app/module/client';
import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { QUESTION_INFORMS } from './financial-profile-questions';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const CATALOGUE_NAMES: ReadonlyArray<string> = LOSS_DRIVERS.map(({ name }) => name);
const CATALOGUE_LABELS: ReadonlyArray<string> = [...CATALOGUE_NAMES, 'All revenue-scaled drivers'];

describe('QUESTION_INFORMS', () => {
  it('names a driver for every card', () => {
    // `names` drops an id the catalogue does not hold, so an empty list is a driver that was
    // retired or whose id was mistyped: the chip would vanish from the card in silence.
    const silent = QUESTION_IDS.filter((id) => QUESTION_INFORMS[id]().length === 0);
    expect(silent).toEqual([]);
  });

  it('labels every driver exactly as the catalogue does', () => {
    const foreign = QUESTION_IDS.flatMap((id) => QUESTION_INFORMS[id]()).filter((label) => !CATALOGUE_LABELS.includes(label));
    expect(foreign).toEqual([]);
  });

  it('carries none of the specification codes', () => {
    // D3.1, D7.5 and their siblings exist in no delivered table. These chips were once the only
    // place a reader could meet them, with nothing in the product to look them up against.
    const coded = QUESTION_IDS.flatMap((id) => QUESTION_INFORMS[id]()).filter((label) => /\bD\d+\.\d+\b/.test(label));
    expect(coded).toEqual([]);
  });
});
