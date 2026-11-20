import { Button } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { Trans } from '@lingui/react/macro';
import { Play } from 'lucide-react';

interface RunCrqButtonProps {
  isRunning: boolean,
  /**
   * Why the run is refused belongs to the surface around the button: `disabled:pointer-events-none`
   * means a disabled FDS button never fires the hover a `title` or a tooltip would need.
   */
  isDisabled: boolean,
  onRun: () => void,
}

export const RunCrqButton: FunctionComponent<RunCrqButtonProps> = ({ isRunning, isDisabled, onRun }) => (
  <Button
    className="relative overflow-hidden"
    startIcon={<Play className="h-4 w-4 shrink-0" />}
    loading={isRunning}
    disabled={isDisabled}
    onClick={onRun}
  >
    <span className="truncate"><Trans>Run CRQ</Trans></span>
  </Button>
);
