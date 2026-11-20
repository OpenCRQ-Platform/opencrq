import { Button, Dialog, DialogBody, DialogContent, DialogTitle, DialogTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { findConfiguredStream, streamFilterPrecis } from '../opencti-stream-filter-utils';
import { useTRPC } from '../../../lib';
import { OpenctiStreamFilter, OpenctiStreamFilterPrecis } from './opencti-stream-filter';
import { OpenctiStreamVerdictChip } from './opencti-stream-verdict';

/**
 * One line in the state card, the filter itself behind a dialog: it is a reference consulted rarely
 * and read slowly, and the clause tree needs a width the card's half-column never had. What the
 * stream fails to deliver is not said here but on the page's banner, which every tab shows.
 */
export const OpenctiConfiguredStream: FunctionComponent<{ streamId: string }> = ({ streamId }) => {
  const trpc = useTRPC();
  const { data: streams, isPending, isError } = useQuery(trpc.opencti.listStreams.queryOptions(undefined, { retry: false }));
  const stream = findConfiguredStream(streams, streamId);

  if (isPending) {
    return null;
  }
  if (isError) {
    return (
      <span className="txt-sub-content text-muted-foreground">
        <Trans>OpenCTI did not answer, so the filter of the stream in use could not be read.</Trans>
      </span>
    );
  }
  if (stream === null) {
    return (
      <span className="txt-sub-content text-muted-foreground">
        <Trans>This stream is no longer among those the deployment's token can see in OpenCTI.</Trans>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <OpenctiStreamVerdictChip verdict={stream.verdict} />
      <span className="text-muted-foreground">
        <OpenctiStreamFilterPrecis precis={streamFilterPrecis(stream.filterGroup, stream.rawFilter, stream.verdict)} />
      </span>
      <Dialog>
        <DialogTrigger asChild>
          <Button priority="tertiary">{t`View filter`}</Button>
        </DialogTrigger>
        <DialogContent size="md">
          <DialogTitle>{stream.name}</DialogTitle>
          <DialogBody>
            <OpenctiStreamFilter filterGroup={stream.filterGroup} rawFilter={stream.rawFilter} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </span>
  );
};
