/** @vitest-environment jsdom */
import { financialProfileAnswersSchema, MAX_FINANCIAL_AMOUNT_USD } from '@app/module/client';
import { zodResolver } from '@hookform/resolvers/zod';
import { i18n } from '@lingui/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FunctionComponent, ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FinancialProfileAnswers } from './financial-profile-schema';
import { LoadedDailyLabourCostCard, Q1AnnualRevenueCard, Q9aRecordsHeldCard, Q13PaymentFlowsCard, Q15RansomPostureCard } from './financial-profile-cards';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS  } from './financial-profile-schema';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const CardHarness: FunctionComponent<{
  defaultValues?: FinancialProfileAnswers,
  children: (form: ReturnType<typeof useForm<FinancialProfileAnswers>>) => ReactNode,
}> = ({ defaultValues, children }) => {
  const form = useForm<FinancialProfileAnswers>({ defaultValues: defaultValues ?? EMPTY_FINANCIAL_PROFILE_ANSWERS });
  return <>{children(form)}</>;
};

/** Validates through the questionnaire's own schema, as the form does, on a click. */
const ValidatedHarness: FunctionComponent<{
  defaultValues: FinancialProfileAnswers,
  children: (form: ReturnType<typeof useForm<FinancialProfileAnswers>>) => ReactNode,
}> = ({ defaultValues, children }) => {
  const form = useForm<FinancialProfileAnswers>({ defaultValues, resolver: zodResolver(financialProfileAnswersSchema) });
  return (
    <>
      {children(form)}
      <button type="button" onClick={() => void form.trigger()}>Validate</button>
    </>
  );
};

const OVER_THE_CEILING = MAX_FINANCIAL_AMOUNT_USD * 10;

describe('amounts over the ceiling', () => {
  it('says so on the loaded daily labour cost, as on the other amounts', async () => {
    render(
      <ValidatedHarness defaultValues={{ ...EMPTY_FINANCIAL_PROFILE_ANSWERS, loadedDailyLabourCost: OVER_THE_CEILING }}>
        {(form) => <LoadedDailyLabourCostCard form={form} countryName={null} countryIsoAlpha3={null} />}
      </ValidatedHarness>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    expect(await screen.findByText(/^Enter at most \$10/)).toBeTruthy();
  });

  it('words the refusal of a revenue over the ceiling, and drops its band echo meanwhile', async () => {
    render(
      <ValidatedHarness defaultValues={{ ...EMPTY_FINANCIAL_PROFILE_ANSWERS, annualRevenue: OVER_THE_CEILING }}>
        {(form) => <Q1AnnualRevenueCard form={form} revenueBand={null} />}
      </ValidatedHarness>,
    );
    expect(screen.getByText(/^Falls in the/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    expect(await screen.findByText(/^Enter at most \$10/)).toBeTruthy();
    expect(screen.queryByText(/^Falls in the/)).toBeNull();
    expect(screen.queryByText(/Too big/)).toBeNull();
  });
});

describe('Q9a records-held gate', () => {
  it('hides the individuals band until the gate answers Yes', () => {
    render(<CardHarness>{(form) => <Q9aRecordsHeldCard form={form} />}</CardHarness>);

    expect(screen.queryByText('Individuals whose data you hold')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByText('Individuals whose data you hold')).toBeTruthy();
  });

  it('closes the individuals band again once the gate answers No', () => {
    render(<CardHarness>{(form) => <Q9aRecordsHeldCard form={form} />}</CardHarness>);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByText('Individuals whose data you hold')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.queryByText('Individuals whose data you hold')).toBeNull();
  });
});

describe('Q13 out-of-band verification gate', () => {
  it('hides the approval-ceiling field until the gate answers Yes', () => {
    render(<CardHarness>{(form) => <Q13PaymentFlowsCard form={form} />}</CardHarness>);

    expect(screen.queryByLabelText('Approval ceiling')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByLabelText('Approval ceiling')).toBeTruthy();
  });

  it('clears the approval-ceiling field once the gate closes back to No', () => {
    render(<CardHarness>{(form) => <Q13PaymentFlowsCard form={form} />}</CardHarness>);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.change(screen.getByLabelText('Approval ceiling'), { target: { value: '5000' } });

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.queryByLabelText('Approval ceiling')).toBeNull();
  });
});

describe('Q15 ransom posture copy switch', () => {
  it('shows the optional payment-ceiling field and the conservative-simplification helper on Yes', () => {
    render(<CardHarness>{(form) => <Q15RansomPostureCard form={form} />}</CardHarness>);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    const ceilingField = screen.getByLabelText<HTMLInputElement>('Payment ceiling (optional)');
    expect(ceilingField).toBeTruthy();
    expect(ceilingField.value).toBe('');
    expect(screen.getByText(/The model draws this amount on every simulated extortion event/)).toBeTruthy();
  });

  it('leaves an already-set ceiling untouched when the gate answers Yes', () => {
    const withCeiling: FinancialProfileAnswers = { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, ransomPaymentCeiling: 3_000_000 };
    render(<CardHarness defaultValues={withCeiling}>{(form) => <Q15RansomPostureCard form={form} />}</CardHarness>);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    const ceilingField = screen.getByLabelText<HTMLInputElement>('Payment ceiling (optional)');
    expect(ceilingField.value).toBe('3,000,000');
  });

  it('states extortion payment is recorded as zero on No, without any ceiling field', () => {
    render(<CardHarness>{(form) => <Q15RansomPostureCard form={form} />}</CardHarness>);

    fireEvent.click(screen.getByRole('button', { name: 'No' }));

    expect(screen.queryByLabelText('Payment ceiling (optional)')).toBeNull();
    expect(screen.getByText(/Extortion payment will be recorded as zero across the board/)).toBeTruthy();
  });
});
