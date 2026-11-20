import { Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TriangleAlert } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DisplayDrawer } from '../../../components/shared';
import { Loader } from '../../../components';
import { useTRPC } from '../../../lib';
import { formatDateTime } from '../../../utils';

const ErrorsTable: FunctionComponent<{ runId: string }> = ({ runId }) => {
  const trpc = useTRPC();
  const { data: errors, isPending, error } = useQuery(trpc.jobs.listJobErrors.queryOptions({ id: runId }));

  if (isPending) {
    return <Loader />;
  }

  if (error || !errors) {
    return <p className="text-default-secondary"><Trans>These errors could not be read.</Trans></p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-default-secondary">
            <th className="border-b px-3 py-2 text-left font-medium"><Trans>Timestamp</Trans></th>
            <th className="border-b px-3 py-2 text-left font-medium"><Trans>Attempt</Trans></th>
            <th className="border-b px-3 py-2 text-left font-medium"><Trans>Retryable</Trans></th>
            <th className="border-b px-3 py-2 text-left font-medium"><Trans>Message</Trans></th>
          </tr>
        </thead>
        <tbody>
          {errors.map((row) => (
            <tr key={row.id}>
              <td className="border-b px-3 py-2.5 align-top whitespace-nowrap tabular-nums">{formatDateTime(row.occurredAt)}</td>
              <td className="border-b px-3 py-2.5 align-top tabular-nums">{row.attempt}</td>
              <td className="border-b px-3 py-2.5 align-top">{row.retryable ? t`Yes` : t`No`}</td>
              <td className="border-b px-3 py-2.5 align-top">{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Errors are read one run at a time: a list of a hundred rows must not issue a hundred reads. */
export const RunErrorsDrawer: FunctionComponent<{
  runId: string,
  runName: string,
  errorCount: number,
}> = ({ runId, runName, errorCount }) => {
  const [open, setOpen] = useState(false);

  const label = t({ message: plural(errorCount, { one: '# error', other: '# errors' }) });
  if (errorCount === 0) {
    return <Chip severity="low" label={label} />;
  }

  return (
    <>
      <Chip
        severity="critical"
        label={label}
        aria-label={t`Errors of ${runName}`}
        onClick={() => setOpen(true)}
      />
      {open && (
        <DisplayDrawer title={t`Errors`} open onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-4 p-5">
            <div
              className="flex items-start gap-2.5 rounded-[var(--fds-radius-sm)] px-5 py-3"
              style={{ background: 'var(--fds-color-feedback-info-secondary-transparency-30)' }}
            >
              <TriangleAlert className="mt-0.5 size-[18px] shrink-0" style={{ color: 'var(--fds-color-feedback-info-primary)' }} />
              <span className="font-content-base text-content-base">
                <Trans>Every error this run recorded, one row per failed attempt.</Trans>
              </span>
            </div>
            <ErrorsTable runId={runId} />
          </div>
        </DisplayDrawer>
      )}
    </>
  );
};
