import type { DeclaredEstateKind } from '@app/module/client';
import { Button, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { CardField, SectionCard } from '../../components/shared';
import { useTRPC } from '../../lib';
import { formatDateTime } from '../../utils/date-utils';
import { EMPTY_VALUE } from '../../utils/empty-value';
import { declaredEstateKindLabel, declaredEstateStateLabel } from './declared-estate-labels';
import { DeclaredEstateMixCard } from './declared-estate-mix-card';
import { DECLARED_ESTATE_KINDS_IN_ASSET_ORDER, declaredEstateMixOf } from './declared-estate-utils';

interface DeclaredEstateTabContentProps {
  organizationId: string,
  onAnswerQuestionnaire: () => void,
}

interface StoredAnswer {
  bounds: { low: number, high: number } | null,
  internetFacing: boolean | null,
  setAt: string | Date | null,
  setByName: string | null,
}

const KindField: FunctionComponent<{ kind: DeclaredEstateKind, answer: StoredAnswer | undefined }> = ({ kind, answer }) => {
  const savedAt = answer?.setAt === null || answer?.setAt === undefined ? null : formatDateTime(answer.setAt);
  const savedBy = answer?.setByName ?? t`Unknown user`;
  return (
    <CardField title={declaredEstateKindLabel(kind)}>
      <p>{answer === undefined || answer.bounds === null ? EMPTY_VALUE : declaredEstateStateLabel(answer)}</p>
      {savedAt !== null && answer?.bounds !== null && (
        <Text as="p" variant="content-caption" className="text-default-secondary">
          <Trans>Saved by {savedBy} on {savedAt}</Trans>
        </Text>
      )}
    </CardField>
  );
};

/** Read-only summary of the declared estate. Editing only happens in the scope drawer. */
export const DeclaredEstateTabContent: FunctionComponent<DeclaredEstateTabContentProps> = ({ organizationId, onAnswerQuestionnaire }) => {
  const trpc = useTRPC();
  const { data: rows, isLoading } = useQuery(trpc.declaredEstate.get.queryOptions({ organizationId }));

  if (isLoading || rows === undefined) {
    return null;
  }

  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const answeredCount = rows.filter((row) => row.bounds !== null).length;
  const totalCount = DECLARED_ESTATE_KINDS_IN_ASSET_ORDER.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-default-secondary">
          {t`${answeredCount} of ${totalCount} answered`}
        </div>
        <Button type="button" priority="primary" onClick={onAnswerQuestionnaire}>{t`Answer the questionnaire`}</Button>
      </div>

      <DeclaredEstateMixCard mix={declaredEstateMixOf(rows)} />

      <SectionCard title={t`Answers`}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
          {DECLARED_ESTATE_KINDS_IN_ASSET_ORDER.map((kind) => <KindField key={kind} kind={kind} answer={byKind.get(kind)} />)}
        </div>
      </SectionCard>
    </div>
  );
};
