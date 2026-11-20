import type { SectionKey } from '@app/module/client';
import { SECTION_QUESTIONS } from '@app/module/client';
import { Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { FinancialProfileAnswers } from './financial-profile-schema';
import { CardField } from '../../components/shared';
import { EMPTY_VALUE } from '../../utils/empty-value';
import { QUESTION_INFORMS, QUESTION_LABELS } from './financial-profile-questions';
import { answerSummary } from './financial-profile-utils';

/**
 * How many drivers the review line names before counting the rest. The questionnaire's chips list
 * them all, because there the reader is deciding whether to answer; here the answers are what they
 * came to read, and two cards reach seven drivers each — spelled out, the annotation runs four
 * lines under a one-line value.
 */
const INFORMS_NAMED = 3;

const informsLine = (labels: ReadonlyArray<string>): string => {
  if (labels.length <= INFORMS_NAMED) {
    return labels.join(' \u00b7 ');
  }
  const named = labels.slice(0, INFORMS_NAMED).join(' \u00b7 ');
  const remaining = labels.length - INFORMS_NAMED;
  return t`${named} and ${remaining} more`;
};

interface FinancialProfileSectionSummaryProps {
  section: SectionKey,
  values: FinancialProfileAnswers,
}

/**
 * Read-only counterpart to FinancialProfileSectionCards, used by the condensed Financial profile
 * tab. It names the drivers each answer reaches, as the questionnaire does, but in one quiet line
 * rather than the questionnaire's chips: here the answers are what the reader came to read, and a
 * grid of chips on every field would outweigh the values they annotate.
 */
export const FinancialProfileSectionSummary: FunctionComponent<FinancialProfileSectionSummaryProps> = ({ section, values }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {SECTION_QUESTIONS[section].map((id) => {
      const informs = informsLine(QUESTION_INFORMS[id]());
      return (
        <CardField key={id} title={QUESTION_LABELS[id]()}>
          <p>{answerSummary(id, values) || EMPTY_VALUE}</p>
          <Text as="p" variant="content-compact" className="mt-1 text-default-secondary">
            <Trans>Informs {informs}</Trans>
          </Text>
        </CardField>
      );
    })}
  </div>
);
