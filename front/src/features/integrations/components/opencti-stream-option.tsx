import type { FunctionComponent } from 'react';
import type { OpenctiStream } from '../opencti-stream-filter-utils';
import { streamFilterPrecis } from '../opencti-stream-filter-utils';
import { OpenctiStreamFilterPrecis } from './opencti-stream-filter';
import { OpenctiStreamVerdictChip } from './opencti-stream-verdict';

/**
 * One row of the stream picker. The précis is visible text inside the option rather than a hint on
 * a glyph: an option carries no control of its own, so a hint that opens on hover is unreachable by
 * keyboard, and the operator comparing streams is the one who needs it most.
 */
export const OpenctiStreamOption: FunctionComponent<{ stream: OpenctiStream }> = ({ stream }) => (
  <div className="flex w-full min-w-0 items-start gap-3">
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{stream.name}</span>
      <span className="txt-sub-content text-muted-foreground">
        <OpenctiStreamFilterPrecis precis={streamFilterPrecis(stream.filterGroup, stream.rawFilter, stream.verdict)} />
      </span>
    </span>
    <span className="ml-auto shrink-0">
      <OpenctiStreamVerdictChip verdict={stream.verdict} />
    </span>
  </div>
);
