import { IconButton, Menu, MenuContent, MenuTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '../../utils';

export { MenuItem as IconActionsItem } from '@filigran/design-system';

interface IconActionsProps {
  children: ReactNode,
  icon: ReactNode,
  label?: ReactNode,
  className?: string,
  priority?: 'secondary' | 'tertiary',
  /** Match the height of the buttons it sits beside; `sm` is the toolbar and table-row default. */
  size?: 'sm' | 'md',
  disabled?: boolean,
}

export const IconActions: FunctionComponent<IconActionsProps> = ({ children, label, icon, className, priority: priorityProp, size: sizeProp, disabled: disabledProp }) => {
  const priority = priorityProp ?? 'tertiary';
  const size = sizeProp ?? 'sm';
  const disabled = disabledProp ?? false;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Menu
      open={menuOpen}
      onOpenChange={(open) => {
        if (disabled && open) {
          return;
        }
        setMenuOpen(open);
      }}
    >
      <div className="flex items-center gap-s">
        {label}
        <MenuTrigger asChild>
          <IconButton
            priority={priority}
            size={size}
            className={cn(menuOpen && 'bg-filigran-brand-primary-transparency-10', className)}
            disabled={disabled}
            aria-label={t`More actions`}
            icon={icon}
          />
        </MenuTrigger>
      </div>
      <MenuContent align="end">
        {children}
      </MenuContent>
    </Menu>
  );
};
