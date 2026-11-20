import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { FindingsFlowWindow } from '../findings-dashboard-utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';

const FLOW_WINDOWS: Array<FindingsFlowWindow> = [30, 90];

/** Labels live here rather than in the util, which stays i18n-free; built per render so a locale switch reaches them. */
const windowLabel = (days: FindingsFlowWindow): string => (days === 30 ? t`Last 30 days` : t`Last 90 days`);

interface FlowWindowSelectProps {
  value: FindingsFlowWindow,
  onChange: (value: FindingsFlowWindow) => void,
  disabled?: boolean,
}

export const FlowWindowSelect: FunctionComponent<FlowWindowSelectProps> = ({ value, onChange, disabled }) => (
  <Select
    value={String(value)}
    disabled={disabled}
    onValueChange={(next) => {
      const selected = FLOW_WINDOWS.find((window) => String(window) === next);
      if (selected !== undefined) {
        onChange(selected);
      }
    }}
  >
    <SelectTrigger className="w-40" aria-label={t`Time window`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {FLOW_WINDOWS.map((window) => (
        <SelectItem key={window} value={String(window)}>
          {windowLabel(window)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
