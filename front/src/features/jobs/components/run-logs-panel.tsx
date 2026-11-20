import { IconButton, Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { Check, Copy } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { JobLogGroup } from '../run-types';
import type { LogGroupView, TimedLogLine } from '../logs-utils';
import { logsListSearchSchema, toLogFilter, toLogUrlFilters } from '../logs-list-search';
import { Loader } from '../../../components';
import { DebouncedSearchField, MultiSelectField } from '../../../components/shared';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { useCopyToClipboard, useUrlListFilters } from '../../../hooks';
import { cn, formatDateTime } from '../../../utils';
import { buildLogView, logGroupText, logLineText, splitOnSearch } from '../logs-utils';
import { logLevelLabel, RUN_STATUS_TEXT_CLASS, runStatusLabel } from '../run-vocabulary';

/* eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not copy */
const HIGHLIGHT_BACKGROUND = 'color-mix(in srgb, var(--fds-color-feedback-alert-primary) 35%, transparent)';

const Highlighted: FunctionComponent<{ text: string, search: string }> = ({ text, search }) => (
  <>
    {splitOnSearch(text, search).map((fragment, index) => (fragment.hit
      ? (
        <mark
          key={`${index}-${fragment.text}`}
          className="rounded-[2px] text-inherit"
          style={{ backgroundColor: HIGHLIGHT_BACKGROUND }}
        >
          {fragment.text}
        </mark>
      )
      : <span key={`${index}-${fragment.text}`}>{fragment.text}</span>))}
  </>
);

export const CopyButton: FunctionComponent<{ text: string, label: string, className?: string }> = ({
  text,
  label,
  className,
}) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <TooltipHint hint={copied ? t`Copied.` : label}>
      <IconButton
        priority="tertiary"
        size="sm"
        className={className}
        aria-label={label}
        icon={copied
          ? <Check className="size-3.5 text-feedback-success-primary" />
          : <Copy className="size-3.5" />}
        onClick={() => {
          void copy(text);
        }}
      />
    </TooltipHint>
  );
};

const LogLine: FunctionComponent<{ entry: TimedLogLine, search: string }> = ({ entry, search }) => {
  const { line, timestamp } = entry;
  const isError = line.level === 'error';
  return (
    <div className="group grid grid-cols-[14rem_3.5rem_minmax(0,1fr)_1.5rem] items-baseline gap-x-3 px-3 hover:bg-[var(--fds-bg-elevation-hover-layer-1)]">
      <span className="tabular-nums text-default-secondary">
        <Highlighted text={timestamp} search={search} />
      </span>
      <span className={cn('uppercase', isError ? 'text-feedback-error-primary' : 'text-default-secondary')}>
        {logLevelLabel(line.level)}
      </span>
      <span className={cn('min-w-0 whitespace-pre-wrap break-words', isError && 'text-feedback-error-primary')}>
        <Highlighted text={line.message} search={search} />
        {line.detail !== null && (
          <span
            className="my-1 block border-l pl-3 text-default-secondary"
            style={{ borderColor: 'var(--fds-color-feedback-error-primary)' }}
          >
            <Highlighted text={line.detail} search={search} />
          </span>
        )}
      </span>
      {isError && (
        <CopyButton
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          text={logLineText(line)}
          label={t`Copy this error`}
        />
      )}
    </div>
  );
};

const RunHeader: FunctionComponent<{ entry: LogGroupView }> = ({ entry: { group } }) => {
  const label = group.status === null
    ? t`Stream`
    : (group.startedAt === null ? t`Run` : formatDateTime(group.startedAt));
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-y bg-[var(--fds-bg-elevation-default-layer-2)] px-3 py-1">
      <span className="font-medium">{label}</span>
      {group.status !== null && (
        <span className={RUN_STATUS_TEXT_CLASS[group.status]}>{runStatusLabel(group.status)}</span>
      )}
      {/* The count is the run's own, not the filtered view's: a shorter list under it means lines are hidden. */}
      <span className="tabular-nums text-default-secondary">
        <Plural value={group.lines.length} one="# line" other="# lines" />
      </span>
      <CopyButton
        className="ml-auto"
        text={logGroupText(group)}
        label={t`Copy this run`}
      />
    </div>
  );
};

export const RunLogsPanel: FunctionComponent<{
  data: { groups: Array<JobLogGroup> } | undefined,
  isPending: boolean,
  error: unknown,
  /** What the store drops once it is full; `null` for a single run's lines, which it keeps or drops whole. */
  retention: 'runs' | 'lines' | null,
}> = ({ data, isPending, error, retention }) => {
  const { filters: urlFilters, setFilters: setUrlFilters } = useUrlListFilters(logsListSearchSchema);
  const logFilter = toLogFilter(urlFilters);
  const view = buildLogView(data?.groups ?? [], logFilter);

  if (isPending) {
    return <Loader />;
  }

  if (error || !data) {
    return (
      <p role="alert" className="txt-sub-content text-muted-foreground">
        <Trans>These logs could not be read.</Trans>
      </p>
    );
  }

  if (data.groups.length === 0) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>No logs available</Trans>
      </p>
    );
  }

  const levelOptions = view.levels.map((level) => ({ value: level, label: logLevelLabel(level) }));

  return (
    <TooltipHintProvider>
      <Paper padding={0} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <DebouncedSearchField
            placeholder={t`Filter these lines...`}
            value={urlFilters.search}
            onCommit={(search) => setUrlFilters({ search })}
            clearLabel={t`Clear the filter`}
            className="w-72"
          />
          <div className="w-72">
            <MultiSelectField
              options={levelOptions}
              value={logFilter.levels}
              onChange={(next) => setUrlFilters(toLogUrlFilters({
                ...logFilter,
                levels: view.levels.filter((level) => next.includes(level)),
              }))}
              label={t`Levels`}
              hideLabel
              placeholder={t`Filter by level`}
              emptyMessage={t`No level found`}
            />
          </div>
        </div>
        <div className="content-code max-h-[calc(100vh-320px)] overflow-auto">
          {view.groups.length === 0
            ? (
              <p className="px-3 py-2 text-default-secondary">
                <Trans>No line matches this filter.</Trans>
              </p>
            )
            : view.groups.map((entry) => (
              <div key={entry.group.runId ?? 'stream'}>
                <RunHeader entry={entry} />
                <div className="py-1">
                  {entry.lines.map((timed) => (
                    <LogLine key={timed.line.id} entry={timed} search={logFilter.search} />
                  ))}
                </div>
              </div>
            ))}
          {retention !== null && (
            <p className="px-3 pt-1 pb-2 text-default-disabled">
              {retention === 'runs'
                ? <Trans>Older runs are not kept.</Trans>
                : <Trans>Older lines are not kept.</Trans>}
            </p>
          )}
        </div>
      </Paper>
    </TooltipHintProvider>
  );
};
