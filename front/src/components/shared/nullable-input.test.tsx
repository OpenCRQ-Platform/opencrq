/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormattedNumberInput } from './nullable-input';

afterEach(() => {
  cleanup();
});

const Harness = ({ onValue }: { onValue: (next: number | null) => void }) => {
  const [value, setValue] = useState<number | null>(null);
  return (
    <FormattedNumberInput
      aria-label="amount"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
};

const type = (text: string) => {
  const field = screen.getByLabelText<HTMLInputElement>('amount');
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: text } });
  return field;
};

describe('FormattedNumberInput', () => {
  it('keeps a decimal amount as typed', () => {
    const seen: Array<number | null> = [];
    render(<Harness onValue={(next) => seen.push(next)} />);
    const field = type('520.5');
    expect(seen.at(-1)).toBe(520.5);
    expect(field.value).toBe('520.5');
  });

  it('holds a trailing decimal point so a decimal can be entered at all', () => {
    render(<Harness onValue={() => {}} />);
    expect(type('520.').value).toBe('520.');
  });

  it('keeps a negative sign, leaving the rule to refuse the value', () => {
    const seen: Array<number | null> = [];
    render(<Harness onValue={(next) => seen.push(next)} />);
    type('-50');
    expect(seen.at(-1)).toBe(-50);
  });

  it('drops thousand separators from a pasted amount', () => {
    const seen: Array<number | null> = [];
    render(<Harness onValue={(next) => seen.push(next)} />);
    type('1,234,567');
    expect(seen.at(-1)).toBe(1_234_567);
  });

  describe('in the language of the application', () => {
    afterEach(() => {
      i18n.activate('en');
    });

    const amounts = [
      { locale: 'fr', typed: '520,5', trailing: '520,' },
      { locale: 'de', typed: '520,5', trailing: '520,' },
    ];

    it.each(amounts)('reads $typed as 520.5 in $locale and shows it as typed', ({ locale, typed }) => {
      i18n.load(locale, {});
      i18n.activate(locale);
      const seen: Array<number | null> = [];
      render(<Harness onValue={(next) => seen.push(next)} />);
      const field = type(typed);
      expect(seen.at(-1)).toBe(520.5);
      expect(field.value).toBe(typed);
    });

    it.each(amounts)('holds $trailing in $locale so a decimal can be entered at all', ({ locale, trailing }) => {
      i18n.load(locale, {});
      i18n.activate(locale);
      render(<Harness onValue={() => {}} />);
      expect(type(trailing).value).toBe(trailing);
    });

    it('still reads a decimal point where the language writes a comma', () => {
      i18n.load('fr', {});
      i18n.activate('fr');
      const seen: Array<number | null> = [];
      render(<Harness onValue={(next) => seen.push(next)} />);
      type('520.5');
      expect(seen.at(-1)).toBe(520.5);
    });
  });

  it('reports a cleared field as no answer', () => {
    const seen: Array<number | null> = [];
    render(<Harness onValue={(next) => seen.push(next)} />);
    type('350');
    type('');
    expect(seen.at(-1)).toBeNull();
  });
});
