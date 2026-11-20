import { SheetContent } from '@filigran/ui';
import type { ComponentPropsWithRef, FunctionComponent } from 'react';
import { cn } from '../../utils';

type DrawerContentProps = ComponentPropsWithRef<typeof SheetContent>;

export const DrawerContent: FunctionComponent<DrawerContentProps> = ({
  className,
  side: sideProp,
  ...props
}) => {
  const side = sideProp ?? 'right';
  return (
    <SheetContent
      aria-describedby={undefined}
      // layer-2 declares the FDS elevation context the legacy sheet cannot: its
      // background equals FDS layer-2 bg-elevation-default (#13213e dark), and a
      // descendant FDS field's resting fill is that very colour on layer-0.
      className={cn('layer-2 flex flex-col min-w-[420px] w-[30vw]', className)}
      side={side}
      {...props}
    />
  );
};
