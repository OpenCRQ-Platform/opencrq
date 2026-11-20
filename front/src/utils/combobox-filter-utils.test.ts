import { describe, expect, it } from 'vitest';
import { filterOptionsByLabel } from './combobox-filter-utils';

describe('filterOptionsByLabel', () => {
  const options = [{ name: 'École Straße' }, { name: 'ecole plain' }, { name: 'Zèbre' }];
  const filter = filterOptionsByLabel((option: { name: string }) => option.name);

  it('should keep every option for an empty or blank input', () => {
    expect(filter(options, '')).toEqual(options);
    expect(filter(options, '   ')).toEqual(options);
  });

  it('should find an accented label from its plain spelling', () => {
    expect(filter(options, 'strasse')).toEqual([options[0]]);
    expect(filter(options, 'zebre')).toEqual([options[2]]);
  });

  it('should find a plain label from an accented input, ignoring case and padding', () => {
    expect(filter(options, '  ÉCO ')).toEqual([options[0], options[1]]);
  });
});
