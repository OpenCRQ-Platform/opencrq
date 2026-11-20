/** A declared rate is the share of people a campaign caught. */
export const PHISHING_FAILURE_RATE_BOUNDS = { min: 0, max: 1 } as const;

/** The day a campaign is checked against, whichever day it is where the reader sits. */
export const utcCalendarDay = (now: Date): string => now.toISOString().slice(0, 10);

export const isMeasuredInFuture = (measuredOn: string, now: Date): boolean => measuredOn > utcCalendarDay(now);

export interface PhishingDeclarationSettings {
  phishingFailureRate: number | null,
  phishingFailureMeasuredOn: string | null,
  measuredValidityDays: number | null,
}

/**
 * The declared rate while its campaign is still a measurement under the tenant's validity window,
 * else null, and the default stands in. Whole UTC days, so a run's inputs hold within a day.
 */
export const freshPhishingFailureRate = (settings: PhishingDeclarationSettings, now: Date): number | null => {
  if (settings.phishingFailureRate === null || settings.phishingFailureMeasuredOn === null) {
    return null;
  }
  if (settings.measuredValidityDays === null) {
    return settings.phishingFailureRate;
  }
  const ageDays = (Date.parse(utcCalendarDay(now)) - Date.parse(settings.phishingFailureMeasuredOn)) / 86_400_000;
  return ageDays <= settings.measuredValidityDays ? settings.phishingFailureRate : null;
};
