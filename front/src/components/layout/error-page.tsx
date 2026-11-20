import { Paper } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { cn } from '../../utils';
import { useIsInsideLayout } from './main-layout';

interface ErrorPageProps {
  children: ReactNode,
}

export const ErrorPage: FunctionComponent<ErrorPageProps> = ({ children }) => {
  const isInsideLayout = useIsInsideLayout();

  const card = (
    <Paper className={cn('w-full max-w-md p-[64px_24px] text-center', !isInsideLayout && 'mt-xl mb-xl')}>
      {children}
    </Paper>
  );

  if (isInsideLayout) {
    return (
      <div className="flex-1 w-full bg-muted/20 flex items-center justify-center">
        {card}
      </div>
    );
  }

  return (
    <main className="absolute inset-0 z-0 m-auto flex flex-col justify-center items-center px-l">
      {card}
    </main>
  );
};
