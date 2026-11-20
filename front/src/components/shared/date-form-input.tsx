import { inputVariants } from '@filigran/design-system';
import { Popover, PopoverContent, PopoverTrigger } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CalendarIcon } from 'lucide-react';
import type { FunctionComponent, Ref } from 'react';
import { useId, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { cn, firstDayOfWeek, formatDate, parseCalendarDate, toCalendarDate } from '../../utils';

/**
 * Drawn here rather than taken from `@filigran/ui`, whose `Calendar` still names the react-day-picker
 * v8 parts (`head_row`, `cell`, `day_selected`) the installed version no longer renders, leaving the
 * weekday row unstyled. Back to its `Calendar` once it targets the current part names.
 */
/* eslint-disable lingui/no-unlocalized-strings -- Tailwind classes, not copy */
const CALENDAR_CLASS_NAMES = {
  root: 'relative p-3',
  months: 'flex flex-col',
  month: 'flex flex-col gap-2',
  month_caption: 'flex h-7 items-center px-1',
  caption_label: 'txt-sub-content font-medium capitalize',
  nav: 'absolute right-3 top-3 flex h-7 items-center gap-1',
  button_previous: 'inline-flex size-7 items-center justify-center rounded-sm text-default-secondary hover:text-primary disabled:opacity-30',
  button_next: 'inline-flex size-7 items-center justify-center rounded-sm text-default-secondary hover:text-primary disabled:opacity-30',
  month_grid: 'w-full border-collapse',
  weekday: 'txt-sub-content size-9 font-normal text-muted-foreground',
  day: 'size-9 p-0 text-center',
  day_button: 'txt-sub-content size-9 rounded-sm hover:bg-accent',
  selected: '[&_button]:bg-primary [&_button]:text-primary-foreground',
  today: '[&_button]:font-semibold [&_button]:text-primary',
  outside: 'text-muted-foreground/50',
  disabled: 'opacity-40',
  hidden: 'invisible',
};
/* eslint-enable lingui/no-unlocalized-strings */

const monthYear = (locale: string, month: Date): string =>
  new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month);

const weekdayName = (locale: string, day: Date, width: 'short' | 'long'): string =>
  new Intl.DateTimeFormat(locale, { weekday: width }).format(day);

interface DateFormInputProps {
  label: string,
  /** Keeps the label for assistive technology only, for a field in a toolbar that names itself by its place. */
  hideLabel?: boolean,
  /** An ISO calendar date, the form the API stores. */
  value: string | null,
  onChange: (value: string | null) => void,
  onBlur?: () => void,
  /** The last day that can be picked, as an ISO calendar date. */
  maxDate?: string,
  inputRef?: Ref<HTMLButtonElement>,
  required?: boolean,
  error?: string,
}

/**
 * A calendar date, which the design system ships no component for yet: this goes when it does. The
 * trigger takes the system's own `inputVariants` recipe, so a date field and a text field beside it
 * stay the same field, and the day is read and written in the application's own language, which a
 * native date input ignores in favour of the browser's.
 */
export const DateFormInput: FunctionComponent<DateFormInputProps> = ({
  label,
  hideLabel,
  value,
  onChange,
  onBlur,
  maxDate,
  inputRef,
  required,
  error,
}) => {
  const [isOpen, setOpen] = useState(false);
  const isRequired = required ?? false;
  const inputId = useId();
  const helperId = `${inputId}-helper`;
  const selected = value === null ? undefined : parseCalendarDate(value) ?? undefined;
  const lastDay = maxDate === undefined ? undefined : parseCalendarDate(maxDate) ?? undefined;
  const locale = i18n.locale || 'en';

  const commit = (next: Date | undefined): void => {
    onChange(next === undefined ? null : toCalendarDate(next));
    setOpen(false);
    onBlur?.();
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {/*
        * Joined without `cn`: tailwind-merge reads `text-input-label` as a font size and drops the
        * `text-2` beside it, which would leave the label a size above every other one of the form.
        */}
      <div className={cn('flex items-center gap-1', hideLabel && 'sr-only')}>
        <label
          htmlFor={inputId}
          className={`font-sans-plex font-medium text-2 ${error ? 'text-input-error' : 'text-input-label'}`}
        >
          {label}
        </label>
        {isRequired && (
          <span aria-hidden="true" className={`font-sans-plex font-normal text-3 ${error ? 'text-input-error' : 'text-input-required'}`}>
            *
          </span>
        )}
      </div>
      <Popover
        open={isOpen}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            onBlur?.();
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={inputRef}
            id={inputId}
            type="button"
            // The field is a button, so its two states have to be spelled out: the asterisk is
            // `aria-hidden` to stay out of the label, and a describedby names the error without
            // saying the field is in error.
            aria-required={isRequired ? true : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? helperId : undefined}
            className={cn(inputVariants({ error: Boolean(error) }), 'flex items-center justify-between gap-2 text-left')}
          >
            <span className={value === null ? 'text-default-secondary' : undefined}>
              {value === null ? t`Pick a date` : formatDate(value)}
            </span>
            <CalendarIcon aria-hidden="true" className="size-4 shrink-0 text-default-secondary" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="bg-card z-50 w-auto rounded-lg border p-0 shadow-xl">
          <DayPicker
            mode="single"
            autoFocus
            showOutsideDays
            selected={selected}
            defaultMonth={selected}
            weekStartsOn={firstDayOfWeek(locale)}
            disabled={lastDay === undefined ? undefined : { after: lastDay }}
            onSelect={commit}
            classNames={CALENDAR_CLASS_NAMES}
            formatters={{
              formatCaption: (month) => monthYear(locale, month),
              formatWeekdayName: (weekday) => weekdayName(locale, weekday, 'short'),
            }}
            // What a screen reader hears. The library speaks English unless told otherwise, and the
            // selected state is left to the cell's own `aria-selected`.
            labels={{
              labelNav: () => t`Month navigation`,
              labelPrevious: () => t`Previous month`,
              labelNext: () => t`Next month`,
              labelGrid: (month) => monthYear(locale, month),
              labelWeekday: (weekday) => weekdayName(locale, weekday, 'long'),
              labelDayButton: (day, modifiers) => {
                const text = formatDate(day);
                return modifiers.today ? t`Today, ${text}` : text;
              },
            }}
          />
          {value !== null && !isRequired && (
            <button
              type="button"
              onClick={() => commit(undefined)}
              className="txt-sub-content w-full border-t p-2 text-center text-default-secondary hover:text-primary"
            >
              <Trans>Clear the date</Trans>
            </button>
          )}
        </PopoverContent>
      </Popover>
      {error && (
        <p id={helperId} className="font-sans-plex font-normal text-2 text-input-error">{error}</p>
      )}
    </div>
  );
};
