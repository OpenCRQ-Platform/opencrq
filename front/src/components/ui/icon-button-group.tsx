import { ButtonGroup, ButtonGroupItem, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import type { ReactNode } from 'react';
import { TooltipHintProvider } from '../shared/tooltip-hint';

export interface IconButtonGroupItem<T extends string> {
  value: T,
  /** A 16px glyph: the design system's group item renders no text of its own. */
  icon: ReactNode,
  tooltip?: string,
  disabled?: boolean,
}

interface IconButtonGroupProps<T extends string> {
  items: Array<IconButtonGroupItem<T>>,
  value: T,
  onChange: (value: T) => void,
}

export const IconButtonGroup = <T extends string>({ items, value, onChange }: IconButtonGroupProps<T>) => (
  <TooltipHintProvider>
    <ButtonGroup
      value={value}
      onValueChange={(next) => {
        const selected = items.find((item) => item.value === next);
        if (selected) {
          onChange(selected.value);
        }
      }}
    >
      {items.map((item) => {
        const trigger = (
          <ButtonGroupItem
            key={item.value}
            value={item.value}
            icon={item.icon}
            disabled={item.disabled}
            aria-label={item.tooltip ?? item.value}
          />
        );

        if (!item.tooltip) {
          return trigger;
        }

        return (
          <Tooltip key={item.value}>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="bottom">{item.tooltip}</TooltipContent>
          </Tooltip>
        );
      })}
    </ButtonGroup>
  </TooltipHintProvider>
);
