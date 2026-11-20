import { isMeasuredInFuture, PHISHING_FAILURE_RATE_BOUNDS } from '@app/module/client';

export type PhishingDeclarationError = 'RATE_OUT_OF_RANGE' | 'RATE_REQUIRED' | 'DATE_REQUIRED' | 'DATE_IN_FUTURE';

export interface PhishingDeclaration {
  /** A share of people caught, in [0, 1]. */
  rate: number | null,
  /** An ISO calendar day. */
  measuredOn: string | null,
}

export type PhishingDeclarationErrors = { [field in 'rate' | 'measuredOn']: PhishingDeclarationError | null };

/** The form speaks percentages, the API shares. */
export const percentToShare = (percent: number | null): number | null => (percent === null ? null : percent / 100);

/** Rounded, since 0.07 x 100 is 7.000000000000001 and the field would show it. */
export const shareToPercent = (share: number | null): number | null => (share === null ? null : Math.round(share * 1e6) / 1e4);

export const validatePhishingDeclaration = (declaration: PhishingDeclaration, now: Date): PhishingDeclarationErrors => {
  const { rate, measuredOn } = declaration;
  const errors: PhishingDeclarationErrors = { rate: null, measuredOn: null };

  if (rate !== null && !(rate >= PHISHING_FAILURE_RATE_BOUNDS.min && rate <= PHISHING_FAILURE_RATE_BOUNDS.max)) {
    errors.rate = 'RATE_OUT_OF_RANGE';
  }
  if (rate === null && measuredOn !== null) {
    errors.rate = 'RATE_REQUIRED';
  }
  if (measuredOn === null && rate !== null) {
    errors.measuredOn = 'DATE_REQUIRED';
  } else if (measuredOn !== null && isMeasuredInFuture(measuredOn, now)) {
    errors.measuredOn = 'DATE_IN_FUTURE';
  }
  return errors;
};
