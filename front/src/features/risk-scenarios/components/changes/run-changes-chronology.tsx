import { Chip, Paper } from '@filigran/design-system';
import type { ChangeEvent, ChangeGroup, ScenarioTab } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, linkOptions } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import type { LabelledMarker } from './run-changes-curve';
import type { ComparedRuns } from './run-changes-group-table';
import type { Chronology, ChronologyNode, ChronologyStop } from './run-changes-utils';
import { cn, formatDate, formatDateMinute } from '../../../../utils';
import { CATEGORY_VIEWS, changeSentence } from './categories';
import { EffectMark } from './change-effect-mark';
import { formatChangeValue } from './change-value-format';
import { assetLink, cveFindingsLink, RunChangesGroupTable, uniqueCveFindingLink } from './run-changes-group-table';

const SCENARIO_ROUTE = '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId';

const SCENARIO_TAB_LINKS = {
  overview: linkOptions({ from: SCENARIO_ROUTE, to: 'overview' }),
  targets: linkOptions({ from: SCENARIO_ROUTE, to: 'targets' }),
  findings: linkOptions({ from: SCENARIO_ROUTE, to: 'findings' }),
  ttp: linkOptions({ from: SCENARIO_ROUTE, to: 'ttp' }),
  threat: linkOptions({ from: SCENARIO_ROUTE, to: 'threat' }),
  'financial-impact': linkOptions({ from: SCENARIO_ROUTE, to: 'financial-impact' }),
  controls: linkOptions({ from: SCENARIO_ROUTE, to: 'controls' }),
  crq: linkOptions({ from: SCENARIO_ROUTE, to: 'crq' }),
} satisfies Record<ScenarioTab, unknown>;

const techniqueLink = (externalId: string) => linkOptions({
  from: '/$tenantId/{-$organizationId}',
  to: 'settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
  params: { techniqueExternalId: externalId },
});

const controlLink = (controlId: string) => linkOptions({
  from: '/$tenantId/{-$organizationId}',
  to: 'controls/$controlId/overview',
  params: { controlId },
});

interface RowFocus {
  onMouseEnter?: () => void,
  onFocus?: () => void,
  onBlur?: () => void,
}

const ChangeRowLink: FunctionComponent<{ event: ChangeEvent, className: string, focus?: RowFocus, children: ReactNode }> = ({ event, className, focus, children }) => {
  const { link } = event.item;
  if (link === null) {
    return <div className={className} {...focus}>{children}</div>;
  }
  const linkClassName = cn(className, 'hover:bg-[var(--fds-bg-elevation-default-layer-3)]');
  if (link.kind === 'technique') {
    return <Link {...techniqueLink(link.externalId)} className={linkClassName} {...focus}>{children}</Link>;
  }
  if (link.kind === 'control') {
    return <Link {...controlLink(link.controlId)} className={linkClassName} {...focus}>{children}</Link>;
  }
  if (link.kind === 'asset') {
    return <Link {...assetLink(link.supportingAssetId)} className={linkClassName} {...focus}>{children}</Link>;
  }
  if (link.kind === 'cve') {
    return <Link {...uniqueCveFindingLink(link.cveId)} className={linkClassName} {...focus}>{children}</Link>;
  }
  if (link.kind === 'cve-findings') {
    return <Link {...cveFindingsLink(link.cveId, link.state)} className={linkClassName} {...focus}>{children}</Link>;
  }
  return <Link {...SCENARIO_TAB_LINKS[link.tab]} className={linkClassName} {...focus}>{children}</Link>;
};

const EngineRow: FunctionComponent<{ event: ChangeEvent }> = ({ event }) => {
  const view = CATEGORY_VIEWS[event.category];
  const values = event.values;
  return (
    <ChangeRowLink event={event} className="grid grid-cols-[minmax(0,1fr)_auto_22px] items-center gap-2.5 border-t border-[var(--fds-border-elevation-subtle)] px-1 py-2 txt-body2">
      <span>{changeSentence(event)}</span>
      {values === null
        ? <span />
        : (
          <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
            <span className="text-muted-foreground">{formatChangeValue(view, event.item, values.format, values.before)}</span>
            <ArrowRight aria-label={t`to`} className="size-3.5 text-muted-foreground" />
            {formatChangeValue(view, event.item, values.format, values.after)}
          </span>
        )}
      <EffectMark direction={event.direction} />
    </ChangeRowLink>
  );
};

const momentKey = (moment: ChangeEvent['moment']): string => {
  switch (moment.kind) {
    case 'recorded':
      return moment.at;
    case 'run':
      return moment.runId;
    case 'balance':
      return 'balance';
  }
};

// One item can move more than once in a window, so the moment tells its rows apart.
const eventKey = (event: ChangeEvent): string =>
  `${event.category}-${event.item.kind}-${event.item.key}-${event.sentence.key}-${event.group?.from ?? ''}-${momentKey(event.moment)}`;

const DatedRow: FunctionComponent<{ event: ChangeEvent, focus: RowFocus }> = ({ event, focus }) => {
  const view = CATEGORY_VIEWS[event.category];
  return (
    <ChangeRowLink event={event} focus={focus} className="flex items-center gap-3 rounded-sm border border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-2)] px-3.5 py-2.5">
      <span className="w-40 shrink-0 txt-container-title text-muted-foreground">{view.label()}</span>
      <span className="flex-1 txt-body2">{changeSentence(event)}</span>
      <EffectMark direction={event.direction} />
    </ChangeRowLink>
  );
};

const rowMomentAt = (target: EventTarget): string | null =>
  (target instanceof Element ? target.closest('tr')?.querySelector('[data-change-at]')?.getAttribute('data-change-at') ?? null : null);

interface GroupRowProps {
  event: ChangeEvent,
  group: ChangeGroup,
  comparison: ComparedRuns,
  showDay: () => void,
  onMarker: RunChangesChronologyProps['onMarker'],
}

/**
 * The group table takes no row handler, so a hovered row is found from the event's target. `onMouseOver`
 * fires on every element the pointer crosses, so `marked` keeps the curve from redrawing on each.
 */
const GroupRow: FunctionComponent<GroupRowProps> = ({ event, group, comparison, showDay, onMarker }) => {
  const view = CATEGORY_VIEWS[event.category];
  const [open, setOpen] = useState(false);
  const marked = useRef<string | null>(null);
  const sentence = view.groupSentence?.(group);
  const mark = (target: EventTarget) => {
    const at = rowMomentAt(target);
    if ((at ?? '') === marked.current) {
      return;
    }
    marked.current = at ?? '';
    if (at === null) {
      showDay();
    } else {
      onMarker({ kind: 'moment', at: new Date(at), label: formatDateMinute(at) });
    }
  };
  return (
    <div
      className={cn('flex flex-col rounded-sm border bg-[var(--fds-bg-elevation-default-layer-2)]', open ? 'border-primary' : 'border-[var(--fds-border-elevation-subtle)]')}
      onMouseOver={(over) => mark(over.target)}
      onMouseLeave={() => {
        marked.current = null;
      }}
      onFocus={(focus) => mark(focus.target)}
      onBlur={() => {
        marked.current = null;
        onMarker(null);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-3 rounded-sm px-3.5 py-2.5 text-left hover:bg-[var(--fds-bg-elevation-default-layer-3)] focus-visible:outline-none focus-visible:ring-2 ring-focus"
      >
        <span className="w-40 shrink-0 txt-container-title text-muted-foreground">{view.label()}</span>
        <span className="flex-1 txt-body2">
          {sentence?.headline}
          {sentence !== undefined && sentence.breakdown !== '' && <span className="text-muted-foreground">{` · ${sentence.breakdown}`}</span>}
        </span>
        <span className="txt-body2 text-primary">{open ? <Trans>Hide</Trans> : <Trans>Show</Trans>}</span>
        <span className="flex items-center gap-1">
          {group.up > 0 && <Chip label={`↑ ${group.up}`} severity="critical" className="tabular-nums" />}
          {group.down > 0 && <Chip label={`↓ ${group.down}`} severity="low" className="tabular-nums" />}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--fds-border-elevation-subtle)] px-3.5 pb-3 pt-3">
          <RunChangesGroupTable comparison={comparison} category={event.category} group={group} />
        </div>
      )}
    </div>
  );
};

const stopLabel = ({ at, withTime }: ChronologyStop): string => (withTime ? formatDateMinute(at) : formatDate(at));

interface RunChangesChronologyProps {
  chronology: Chronology,
  comparison: ComparedRuns,
  beforeValue: ReactNode,
  afterValue: ReactNode,
  changeChip: ReactNode,
  onMarker: (marker: LabelledMarker | null) => void,
}

const Rail: FunctionComponent = () => <span className="w-0.5 flex-1 bg-[var(--fds-border-elevation-subtle)]" />;

const NodeRows: FunctionComponent<{ node: ChronologyNode, comparison: ComparedRuns, onMarker: RunChangesChronologyProps['onMarker'] }> = ({ node, comparison, onMarker }) => {
  const show = () => onMarker({ ...node.marker, label: stopLabel(node) });
  const focus: RowFocus = { onMouseEnter: show, onFocus: show, onBlur: () => onMarker(null) };
  return node.events.map((event) => (event.group === undefined
    ? <DatedRow key={eventKey(event)} event={event} focus={focus} />
    : <GroupRow key={eventKey(event)} event={event} group={event.group} comparison={comparison} showDay={show} onMarker={onMarker} />));
};

export const RunChangesChronology: FunctionComponent<RunChangesChronologyProps> = ({ chronology, comparison, beforeValue, afterValue, changeChip, onMarker }) => {
  const { before, nodes, after, balance } = chronology;
  const empty = nodes.length === 0 && after.events.length === 0 && balance.length === 0;
  const beforeLabel = stopLabel(before);
  const afterLabel = stopLabel(after);
  return (
    <Paper className="flex flex-col" onMouseLeave={() => onMarker(null)}>
      <ol aria-label={t`Chronology of the changes`} className="grid grid-cols-[136px_28px_minmax(0,1fr)] gap-x-4">
        <li className="contents">
          <span className="whitespace-nowrap text-right txt-sub-content leading-8 text-muted-foreground">{beforeLabel}</span>
          <span aria-hidden className="flex flex-col items-center self-stretch">
            <span className="mt-2 size-4 rounded-full border-[3px] border-muted-foreground" />
            <Rail />
          </span>
          <div className="flex items-baseline gap-3 pb-5">
            <span className="font-medium leading-8"><Trans>Earlier run</Trans></span>
            <span className="txt-subtitle2 font-bold text-muted-foreground">{beforeValue}</span>
          </div>
        </li>

        {nodes.map((node) => (
          <li key={`${node.kind}-${node.at.getTime()}`} className="contents">
            <span className={cn('whitespace-nowrap pt-0.5 text-right txt-sub-content leading-5', node.withTime ? 'text-default-primary' : 'text-muted-foreground')}>{stopLabel(node)}</span>
            <span aria-hidden className="flex flex-col items-center self-stretch">
              {node.kind === 'run'
                ? <span className="mt-1 size-3.5 rounded-full border-2 border-primary" />
                : <span className="mt-1.5 size-2.5 rounded-full bg-primary" />}
              <Rail />
            </span>
            <div className="flex flex-col gap-2 pb-4.5">
              {node.kind === 'run' && <span className="txt-body2 font-medium leading-6"><Trans context="engine run">Run</Trans></span>}
              <NodeRows node={node} comparison={comparison} onMarker={onMarker} />
            </div>
          </li>
        ))}

        {empty && (
          <li className="contents">
            <span />
            <span aria-hidden className="flex flex-col items-center self-stretch"><Rail /></span>
            <p className="pb-5 pt-1 txt-sub-content text-muted-foreground"><Trans>No change of these categories between the two runs</Trans></p>
          </li>
        )}

        <li className="contents">
          <span className="whitespace-nowrap text-right txt-sub-content leading-8">{afterLabel}</span>
          <span aria-hidden className="flex flex-col items-center">
            <span className="mt-2 size-4 rounded-full bg-primary" />
          </span>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="font-medium leading-8"><Trans>Later run</Trans></span>
              <span className="txt-subtitle2 font-bold">{afterValue}</span>
              {changeChip}
            </div>
            <NodeRows node={after} comparison={comparison} onMarker={onMarker} />
            {balance.length > 0 && (
              <div className="flex flex-col rounded-sm border border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-2)] px-3.5 py-1.5">
                <span className="py-2 txt-sub-content text-muted-foreground">
                  <Trans>What the engine computed differently between the run of {beforeLabel} and the run of {afterLabel}</Trans>
                </span>
                {balance.map((event) => <EngineRow key={eventKey(event)} event={event} />)}
              </div>
            )}
          </div>
        </li>
      </ol>
    </Paper>
  );
};
