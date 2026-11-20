import { Chip, Tabs, TabsContent, TabsList, TabsTrigger } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { StreamFilterClause, StreamFilterGroup, StreamFilterPrecis } from '../opencti-stream-filter-utils';
import { formatRawFilter } from '../opencti-stream-filter-utils';
import { streamFilterKeyLabel, streamFilterOperatorLabel } from '../connector-vocabulary';

/** What a stream's filter holds, in the one sentence the picker hints on a row. */
export const OpenctiStreamFilterPrecis: FunctionComponent<{ precis: StreamFilterPrecis }> = ({ precis }) => {
  if (precis.kind === 'absent' || precis.kind === 'unconstrained') {
    return <Trans>No filter. Everything the token can see.</Trans>;
  }
  if (precis.kind === 'unreadable') {
    return <Trans>This filter could not be read.</Trans>;
  }
  if (precis.kind === 'admits-nothing') {
    return <Trans>Admits nothing: its conditions on entity type cannot hold together.</Trans>;
  }
  if (precis.kind === 'indeterminate') {
    return <Trans>Its conditions on entity type are more than this line can state. Read the filter.</Trans>;
  }
  if (precis.kind === 'other-keys') {
    const keys = precis.keys.map(streamFilterKeyLabel).join(', ');
    return i18n._({ id: 'Selects by {keys}, and names no type.', message: 'Selects by {keys}, and names no type.', values: { keys } });
  }
  const types = precis.entityTypes.join(', ');
  return precis.exhaustive
    ? i18n._({ id: 'Admits {types}, and nothing else.', message: 'Admits {types}, and nothing else.', values: { types } })
    : i18n._({ id: 'Admits {types}, with further conditions.', message: 'Admits {types}, with further conditions.', values: { types } });
};

const Clause: FunctionComponent<{ clause: StreamFilterClause }> = ({ clause }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <span className="txt-sub-content text-muted-foreground">{streamFilterKeyLabel(clause.key[0] ?? '')}</span>
    <span className="txt-sub-content italic text-muted-foreground">{streamFilterOperatorLabel(clause.operator)}</span>
    {clause.values.map((value) => (
      <Chip key={value} severity="neutral" label={value} />
    ))}
  </div>
);

const Group: FunctionComponent<{ group: StreamFilterGroup }> = ({ group }) => {
  const parts = group.filters.length + group.filterGroups.length;
  return (
    <div className="flex flex-col gap-2">
      {parts > 1 && (
        <span className="txt-category text-muted-foreground">
          {group.mode === 'and' ? t`All of` : t`Any of`}
        </span>
      )}
      <div className={parts > 1 ? 'flex flex-col gap-2.5 border-l pl-3.5' : 'flex flex-col gap-2.5'}>
        {group.filters.map((clause, index) => (
          <Clause key={`${clause.key[0]}-${clause.operator}-${index}`} clause={clause} />
        ))}
        {group.filterGroups.map((child, index) => (
          <Group key={index} group={child} />
        ))}
      </div>
    </div>
  );
};

interface OpenctiStreamFilterProps {
  filterGroup: StreamFilterGroup | null,
  rawFilter: string | null,
}

/**
 * A stream's filter as the operator can read it, with OpenCTI's own JSON behind a tab for whoever is
 * going to edit the stream there. A filter this platform could not read has no readable view at all,
 * so the raw one is all there is to show.
 */
export const OpenctiStreamFilter: FunctionComponent<OpenctiStreamFilterProps> = ({ filterGroup, rawFilter }) => {
  if (rawFilter === null) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>This stream carries no filter. Everything its token can see passes through it.</Trans>
      </p>
    );
  }

  const raw = <pre className="txt-sub-content overflow-x-auto whitespace-pre font-mono">{formatRawFilter(rawFilter)}</pre>;

  if (filterGroup === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="txt-sub-content text-muted-foreground">
          <Trans>This filter could not be read. It is shown here as OpenCTI stores it.</Trans>
        </p>
        {raw}
      </div>
    );
  }

  return (
    <Tabs defaultValue="readable">
      <TabsList>
        <TabsTrigger value="readable">{t`Readable`}</TabsTrigger>
        <TabsTrigger value="raw">{t`Raw`}</TabsTrigger>
      </TabsList>
      <TabsContent value="readable" className="pt-3">
        <Group group={filterGroup} />
      </TabsContent>
      <TabsContent value="raw" className="pt-3">
        {raw}
      </TabsContent>
    </Tabs>
  );
};
