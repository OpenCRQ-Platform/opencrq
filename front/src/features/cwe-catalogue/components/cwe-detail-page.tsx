import { Button } from '@filigran/design-system';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { ConfirmDialog, DetailPageLayout, SectionCard } from '../../../components/shared';
import { DataPageWithTtpMatrix } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useHasManageSecurity } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { CweLinkStateBadge } from '../ui/cwe-link-state-badge';
import { AddCweTechniqueDialog } from './add-cwe-technique-dialog';

type LinkedTechnique = inferRouterOutputs<TRPCRouter>['cwe']['get']['techniques'][number];
type TechniqueRow = LinkedTechnique & { id: string };

const Justifications: FunctionComponent<{ technique: LinkedTechnique }> = ({ technique }) => {
  if (technique.justifications.length === 0) {
    return <EmptyValue />;
  }
  return (
    <ul className="flex flex-col gap-1">
      {technique.justifications.map(({ kind, ref, name }) => (
        <li key={`${kind}:${ref}`}>
          {kind === 'attack_pattern'
            ? <Trans>Attack pattern <span className="font-mono">{ref}</span> {name}</Trans>
            : <Trans>Consequence: {ref}</Trans>}
        </li>
      ))}
    </ul>
  );
};

interface CweDetailPageProps {
  cweId: string,
}

export const CweDetailPage: FunctionComponent<CweDetailPageProps> = ({ cweId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const canEdit = useHasManageSecurity();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);

  const { data: cwe, isLoading } = useQuery(trpc.cwe.get.queryOptions({ cweId }));

  const addTechnique = useMutation(trpc.cwe.addTechnique.mutationOptions({
    meta: { successMessage: msg`Technique added successfully.` },
  }));
  const removeTechnique = useMutation(trpc.cwe.removeTechnique.mutationOptions({
    meta: { successMessage: msg`Technique removed successfully.` },
  }));
  const restoreTechnique = useMutation(trpc.cwe.restoreTechnique.mutationOptions({
    meta: { successMessage: msg`Technique restored successfully.` },
  }));
  const resetCwe = useMutation(trpc.cwe.reset.mutationOptions({
    meta: { successMessage: msg`Weakness reset to the shipped techniques successfully.` },
  }));

  const techniques = cwe?.techniques ?? [];
  const overrideCount = cwe?.overrideCount ?? 0;
  const title = cwe === undefined ? cweId : `${cwe.externalId} · ${cwe.name}`;

  const rows: Array<TechniqueRow> = techniques.map((technique) => ({ ...technique, id: technique.techniqueId }));

  const originLabel = t`Origin`;
  const addedLabel = t`Added`;
  // A removed technique drops out of the matrix; the list keeps its line so it stays restorable.
  const highlightedTechniques: Array<HighlightedTechnique> = techniques
    .filter((technique) => technique.state !== 'removed')
    .map((technique) => ({
      id: technique.techniqueId,
      color: 'red',
      tooltipExtra: technique.state === 'added' ? [{ label: originLabel, value: addedLabel }] : undefined,
    }));

  const actionsColumn: ColumnDefWithOptionsHeader<TechniqueRow, unknown> = {
    id: 'actions',
    accessorKey: 'techniqueId',
    header: '',
    size: 120,
    enableSorting: false,
    cell: ({ row }): ReactElement => (
      <Button
        priority="tertiary"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          const input = { cweId, techniqueId: row.original.techniqueId };
          if (row.original.state === 'removed') {
            restoreTechnique.mutate(input);
          } else {
            removeTechnique.mutate(input);
          }
        }}
      >
        {row.original.state === 'removed' ? <Trans>Restore</Trans> : <Trans>Remove</Trans>}
      </Button>
    ),
  };

  const columns: Array<ColumnDefWithOptionsHeader<TechniqueRow, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`Technique`,
      size: 280,
      cell: ({ row }): ReactElement => (
        <span className={cn(row.original.state === 'removed' && 'line-through text-muted-foreground')}>
          <span className="font-mono txt-sub-content text-muted-foreground">{row.original.externalId}</span>
          {' '}{row.original.name}
        </span>
      ),
    },
    {
      id: 'justifications',
      header: t`Justification`,
      size: 360,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <div className={cn(row.original.state === 'removed' && 'text-muted-foreground')}>
          <Justifications technique={row.original} />
        </div>
      ),
    },
    {
      id: 'state',
      accessorKey: 'state',
      header: t`Origin`,
      size: 120,
      cell: ({ row }): ReactElement => <CweLinkStateBadge value={row.original.state} />,
    },
    ...(canEdit ? [actionsColumn] : []),
  ];

  const actions = (
    <div className="flex items-center gap-2">
      <Button priority="secondary" disabled={cwe === undefined} onClick={() => setIsAddOpen(true)}>
        <Trans>Add technique</Trans>
      </Button>
      <Button priority="secondary" disabled={overrideCount === 0} onClick={() => setIsResetOpen(true)}>
        <Trans>Reset</Trans>
      </Button>
    </div>
  );

  return (
    <DetailPageLayout title={title} actions={canEdit ? actions : undefined}>
      <SectionCard title={t`Description`}>
        {cwe === undefined ? <EmptyValue /> : <p>{cwe.description}</p>}
      </SectionCard>
      <SectionCard title={t`Techniques made possible`}>
        <DataPageWithTtpMatrix
          data={rows}
          columns={columns}
          isLoading={isLoading}
          storageKey="cwe-techniques"
          highlightedTechniques={highlightedTechniques}
          defaultView="table"
          onClickRow={(row) => {
            void navigate({
              to: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
              params: (prev) => ({ tenantId: prev.tenantId!, techniqueExternalId: row.original.externalId }),
            });
          }}
        />
      </SectionCard>
      {canEdit && (
        <>
          <AddCweTechniqueDialog
            open={isAddOpen}
            onOpenChange={setIsAddOpen}
            listedTechniqueIds={techniques.map((technique) => technique.techniqueId)}
            onConfirm={(techniqueId) => addTechnique.mutate({ cweId, techniqueId })}
          />
          <ConfirmDialog
            open={isResetOpen}
            onOpenChange={setIsResetOpen}
            onConfirm={() => resetCwe.mutate({ cweId })}
            title={<Trans>Reset to the shipped techniques</Trans>}
            description={plural(overrideCount, {
              one: '# technique you added or removed is discarded and the techniques the platform ships apply again. This cannot be undone.',
              other: '# techniques you added or removed are discarded and the techniques the platform ships apply again. This cannot be undone.',
            })}
            submitButtonText={<Trans>Reset</Trans>}
          />
        </>
      )}
    </DetailPageLayout>
  );
};
