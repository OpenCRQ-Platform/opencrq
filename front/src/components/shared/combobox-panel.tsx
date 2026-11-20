import { ComboboxContent } from '@filigran/design-system';
import type { ComponentPropsWithoutRef, FunctionComponent } from 'react';

type ComboboxPanelProps = ComponentPropsWithoutRef<typeof ComboboxContent>;

/**
 * FDS 1.0.0: the Combobox panel is portalled to `<body>`, and the react-remove-scroll lock the
 * Radix modal Dialog behind our drawer arms cancels every wheel event landing outside the dialog
 * overlay and outside the shards it declares, so the panel's list cannot be scrolled. Stopping
 * the event at the panel keeps it from reaching that document-level listener.
 */
export const ComboboxPanel: FunctionComponent<ComboboxPanelProps> = ({ onWheel, ...props }) => (
  <ComboboxContent
    {...props}
    onWheel={(event) => {
      onWheel?.(event);
      event.stopPropagation();
    }}
  />
);
