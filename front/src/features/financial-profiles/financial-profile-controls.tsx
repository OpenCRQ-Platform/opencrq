import type { QuestionId } from '@app/module/client';
import { Button, Chip, Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { QUESTION_INFORMS, QUESTION_LABELS } from './financial-profile-questions';

interface BandOption<T extends string> {
  value: T,
  label: string,
}

interface BandSelectProps<T extends string> {
  value: T | null,
  onChange: (value: T | null) => void,
  options: ReadonlyArray<BandOption<T>>,
}

/**
 * A single-select band control: market breakpoints as discrete choices, never a slider. The picked
 * button takes a transparent border, since only the secondary one carries a 1 px border and a pick
 * would otherwise shift the row.
 */
export const BandSelect = <T extends string>({ value, onChange, options }: BandSelectProps<T>): ReactNode => (
  <div className="flex flex-wrap gap-2">
    {options.map((option) => (
      <Button
        key={option.value}
        type="button"
        size="sm"
        aria-pressed={value === option.value}
        priority={value === option.value ? 'primary' : 'secondary'}
        className={value === option.value ? 'border border-transparent' : undefined}
        onClick={() => onChange(value === option.value ? null : option.value)}
      >
        {option.label}
      </Button>
    ))}
  </div>
);

interface YesNoGateProps {
  value: boolean | null,
  onChange: (value: boolean | null) => void,
}

/**
 * A boolean severity gate as a Yes/No band pair: a two-state switch cannot distinguish
 * "not answered yet" from "no", and that distinction is what un-counts a closed gate as an answer.
 */
export const YesNoGate: FunctionComponent<YesNoGateProps> = ({ value, onChange }) => (
  <BandSelect
    value={value === null ? null : (value ? 'yes' : 'no')}
    onChange={(picked) => onChange(picked === null ? null : picked === 'yes')}
    options={[{ value: 'yes', label: t`Yes` }, { value: 'no', label: t`No` }]}
  />
);

interface QuestionCardProps {
  id: QuestionId,
  definition?: ReactNode,
  children: ReactNode,
}

/** The card unit every question renders through: label/definition/control/informs chips. */
export const QuestionCard: FunctionComponent<QuestionCardProps> = ({ id, definition, children }) => (
  <Paper elevation={1} className="flex flex-col gap-3 p-4">
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <Text as="span" variant="content-compact-bold">{QUESTION_LABELS[id]()}</Text>
      </div>
    </div>
    {definition && (
      <Text as="p" variant="content-compact" className="text-default-secondary">{definition}</Text>
    )}
    <div className="flex flex-col gap-3">{children}</div>
    <div className="flex flex-wrap items-center gap-2 border-t border-elevation-subtle-soft pt-3">
      <Text as="span" variant="content-compact" className="text-default-secondary">{t`Informs`}</Text>
      {QUESTION_INFORMS[id]().map((label) => (
        <Chip key={label} label={label} severity="info" />
      ))}
    </div>
  </Paper>
);

interface FieldWithSuffixProps {
  children: ReactNode,
  suffix: string,
}

/** items-end, not items-center: children can carry a label above the control, and the suffix must line up with the control itself, not the midpoint of label+control. */
export const FieldWithSuffix: FunctionComponent<FieldWithSuffixProps> = ({ children, suffix }) => (
  <div className="flex items-end gap-2">
    <div className="flex-1">{children}</div>
    <Text as="span" variant="content-compact" className="pb-2 text-default-secondary whitespace-nowrap">{suffix}</Text>
  </div>
);
