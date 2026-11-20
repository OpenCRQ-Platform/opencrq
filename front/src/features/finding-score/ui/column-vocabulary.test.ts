import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { cvssMetricLabel, cvssValueLabel } from './column-vocabulary';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const V2 = 'AV:N/AC:M/Au:S/C:N/I:P/A:C';
const V31 = 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:H';

describe('the CVSS vocabulary', () => {
  it('words a 2.0 vector in its own metrics and values', () => {
    expect(cvssMetricLabel('Au', V2)).toBe('Authentication');
    expect(cvssValueLabel('Au', 'S', V2)).toBe('single');
    expect(cvssValueLabel('Au', 'M', V2)).toBe('multiple');
    expect(cvssValueLabel('AC', 'M', V2)).toBe('medium');
    expect(cvssValueLabel('I', 'P', V2)).toBe('partial');
    expect(cvssValueLabel('A', 'C', V2)).toBe('complete');
    expect(cvssValueLabel('C', 'N', V2)).toBe('none');
  });

  it('names the privileges term of a 2.0 vector by the authentication it was read from', () => {
    expect(cvssMetricLabel('PR', V2)).toBe('Authentication');
    expect(cvssValueLabel('PR', 'N', V2)).toBe('none needed');
    expect(cvssValueLabel('PR', 'S', V2)).toBe('single');
  });

  it('leaves the 3.1 wording as it was', () => {
    expect(cvssMetricLabel('PR', V31)).toBe('Privileges');
    expect(cvssValueLabel('PR', 'L', V31)).toBe('low');
    expect(cvssValueLabel('A', 'H', V31)).toBe('high');
  });
});
