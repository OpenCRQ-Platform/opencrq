import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import type { TefSizeClass } from '@app/module/client';
import type { CountryNote, FrequencyProfile, ProfileLabels, SectorNote, SizeNote, TefCatalog } from '../threat-event-frequency-utils';
import { sizeClassOfEmployees } from '@app/module/client';
import { formatRevenueBand } from '../../../utils/format-revenue-band';
import { formatNumber, formatPrecision, formatSignificant } from '../../../utils/format-number';
import { hasEmployeeCount, recurrence, sizeClassBounds } from '../threat-event-frequency-utils';

/** Names joined the way the reader's language joins a list: "a, b and c", "a, b et c". */
export const listOf = (names: ReadonlyArray<string>): string =>
  new Intl.ListFormat(i18n.locale || 'en', { type: 'conjunction' }).format(names);

/** Attempts per year at three significant digits, the precision the catalogue's rows carry. */
export const formatAttempts = (value: number): string => formatSignificant(value, 3);

/** A range's bounds at two significant digits, a trailing zero kept: the catalogue does not know its bounds closer. */
export const formatRange = (low: number, high: number): string => {
  const from = formatPrecision(low, 2);
  const to = formatPrecision(high, 2);
  return i18n._({ id: '{from} to {to}', message: '{from} to {to}', values: { from, to } });
};

/** Rounded to two significant digits before the plural is chosen, so that 0.98 reads "1 year". */
export const recurrenceText = (attemptsPerYear: number): string | undefined => {
  const period = recurrence(attemptsPerYear);
  if (period === undefined) {
    return undefined;
  }
  const amount = Number(period.value.toPrecision(2));
  return period.unit === 'months'
    ? plural(amount, { one: 'About once every # month', other: 'About once every # months' })
    : plural(amount, { one: 'About once every # year', other: 'About once every # years' });
};

/** A size class as headcounts alone, for a field already labelled with the employees: "1,000-4,999", "5,000+". */
export const sizeClassRange = (sizeClass: TefSizeClass): string => {
  const { from, to } = sizeClassBounds(sizeClass);
  return to === null ? `${formatNumber(from)}+` : `${formatNumber(from)}-${formatNumber(to)}`;
};

export const sizeClassLabel = (sizeClass: TefSizeClass): string => {
  const range = sizeClassRange(sizeClass);
  return i18n._({ id: '{range} employees', message: '{range} employees', values: { range } });
};

export const employeesLabel = (employeeCount: number): string =>
  plural(employeeCount, { one: '# employee', other: '# employees' });

/** The headcounts a range of classes spans: "50 to 249 employees", or "50 employees or more" up to the open class. */
const sizeSpan = (from: TefSizeClass, to: TefSizeClass): string => {
  const low = formatNumber(sizeClassBounds(from).from);
  const lastHigh = sizeClassBounds(to).to;
  if (lastHigh === null) {
    return i18n._({ id: '{low} employees or more', message: '{low} employees or more', values: { low } });
  }
  const high = formatNumber(lastHigh);
  return i18n._({ id: '{low} to {high} employees', message: '{low} to {high} employees', values: { low, high } });
};

/** A part the scope leaves unset, named, so that its chip reads the same with or without a field label beside it. */
export const unsetPartText = (part: keyof ProfileLabels): string => {
  const texts: Record<keyof ProfileLabels, string> = { country: t`Country not set`, sector: t`Sector not set`, size: t`Size not set` };
  return texts[part];
};

export const countryNoteText = (note: CountryNote): string => {
  const texts: Record<CountryNote, string> = {
    unset: t`Country not filled in: the figure comes from every country.`,
    not_covered: t`Country not measured: the figure comes from every country.`,
    pooled: t`Country not measured: its level comes from a group of countries.`,
  };
  return texts[note];
};

export const sectorNoteText = (note: SectorNote): string => {
  const texts: Record<SectorNote, string> = {
    unset: t`Sector not filled in: the figure comes from every sector.`,
    every_sector: t`Sector not measured: the figure comes from every sector of the country.`,
    other_countries: t`Sector not measured in this country: the figure comes from other countries' surveys.`,
  };
  return texts[note];
};

export const sizeNoteText = (note: SizeNote): string => {
  switch (note.kind) {
    case 'unset':
      return t`Employee count and revenue not filled in: the figure is the average across all sizes.`;
    case 'revenue_band': {
      const span = sizeSpan(note.from, note.to);
      return i18n._({
        id: 'Employee count not filled in: size inferred from the revenue, {span}.',
        message: 'Employee count not filled in: size inferred from the revenue, {span}.',
        values: { span },
      });
    }
    case 'extended': {
      const sizeClass = sizeClassLabel(note.sizeClass);
      return i18n._({
        id: 'Size not published by the surveys: the figure for {sizeClass} is extended from the published sizes.',
        message: 'Size not published by the surveys: the figure for {sizeClass} is extended from the published sizes.',
        values: { sizeClass },
      });
    }
  }
};

/**
 * The profile's parts as its chips read them. The size is the headcount, or its class where the
 * simulator chose one, else the revenue band it is inferred from.
 */
export const profileLabels = (catalog: TefCatalog, profile: FrequencyProfile, sizeAsClass = false): ProfileLabels => {
  const size = (() => {
    if (hasEmployeeCount(profile)) {
      return sizeAsClass ? sizeClassLabel(sizeClassOfEmployees(profile.employeeCount)) : employeesLabel(profile.employeeCount);
    }
    if (profile.revenueBand !== null) {
      const band = formatRevenueBand(profile.revenueBand);
      return i18n._({ id: 'Revenue {band}', message: 'Revenue {band}', values: { band } });
    }
    return null;
  })();
  return {
    country: catalog.countries.find((country) => country.id === profile.countryId)?.name ?? null,
    sector: catalog.sectors.find((sector) => sector.id === profile.sectorId)?.name ?? null,
    size,
  };
};
