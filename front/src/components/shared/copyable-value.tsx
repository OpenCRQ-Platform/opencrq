import { IconButton } from '@filigran/design-system';
import { Check, Copy } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useCopyToClipboard } from '../../hooks';
import { TooltipHint, TooltipHintProvider } from './tooltip-hint';

interface CopyableValueProps {
  value: string,
  /** The button's accessible name and tooltip, naming what is copied. */
  copyLabel: string,
}

export const CopyableValue: FunctionComponent<CopyableValueProps> = ({ value, copyLabel }) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <code className="content-code flex h-8 min-w-0 flex-1 items-center rounded-sm border border-elevation-default bg-input-default px-2 select-all">
        <span className="truncate" title={value}>{value}</span>
      </code>
      <TooltipHintProvider>
        <TooltipHint hint={copyLabel}>
          <IconButton
            priority="tertiary"
            size="sm"
            aria-label={copyLabel}
            icon={copied ? <Check className="size-4 text-icon-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            onClick={() => {
              void copy(value);
            }}
          />
        </TooltipHint>
      </TooltipHintProvider>
    </div>
  );
};
