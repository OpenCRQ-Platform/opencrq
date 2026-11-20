import { IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Pin } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { cn } from '../../../utils';

interface ScopePinButtonProps {
  pinned: boolean,
  onToggle: (pinned: boolean) => void,
}

export const ScopePinButton: FunctionComponent<ScopePinButtonProps> = ({ pinned, onToggle }) => {
  const label = pinned ? t`Remove from the bar` : t`Pin to the bar`;
  return (
    <TooltipHintProvider>
      <TooltipHint hint={label}>
        <IconButton
          priority="tertiary"
          size="sm"
          className={cn(!pinned && 'text-default-secondary')}
          aria-label={label}
          aria-pressed={pinned}
          icon={<Pin className="h-4 w-4" fill={pinned ? 'currentColor' : 'none'} />}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(!pinned);
          }}
        />
      </TooltipHint>
    </TooltipHintProvider>
  );
};
