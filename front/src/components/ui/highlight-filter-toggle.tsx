import { IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Eye, EyeOff } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { TooltipHint, TooltipHintProvider } from '../shared/tooltip-hint';

interface HighlightFilterToggleProps {
  active: boolean,
  onToggle: () => void,
}

/** Folds an ATT&CK matrix down to the highlighted techniques, and back. */
export const HighlightFilterToggle: FunctionComponent<HighlightFilterToggleProps> = ({ active, onToggle }) => {
  const label = active ? t`Show all techniques` : t`Show highlighted only`;
  return (
    <TooltipHintProvider>
      <TooltipHint hint={label}>
        <IconButton
          priority="secondary"
          active={active}
          icon={active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          aria-label={label}
          onClick={onToggle}
        />
      </TooltipHint>
    </TooltipHintProvider>
  );
};
