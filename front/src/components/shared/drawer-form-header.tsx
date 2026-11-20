import { SheetHeader, SheetTitle } from '@filigran/ui';
import type { FunctionComponent, ReactNode } from 'react';

interface DrawerFormHeaderProps {
  category?: ReactNode,
  title?: ReactNode,
}

export const DrawerFormHeader: FunctionComponent<DrawerFormHeaderProps> = ({ category, title }) => (
  <SheetHeader>
    {category && (
      <p className="txt-sub-content text-muted-foreground uppercase tracking-widest font-semibold">
        {category}
      </p>
    )}
    {title && (
      <SheetTitle className="txt-default leading-tight line-clamp-2">
        {title}
      </SheetTitle>
    )}
  </SheetHeader>
);
