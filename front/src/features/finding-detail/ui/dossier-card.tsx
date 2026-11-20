import { Paper } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { cn } from '../../../utils';
import { SectionLabel } from './section-label';

interface DossierCardProps {
  label: string,
  children: ReactNode,
  className?: string,
  /** Sits on the label line, right-aligned: a view switch, never a destructive action. */
  headerAction?: ReactNode,
}

/** A section of the finding dossier: the label sits above the Paper, as every other page does. */
export const DossierCard: FunctionComponent<DossierCardProps> = ({ label, children, className, headerAction }) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <div className="flex min-h-8 items-center justify-between gap-4">
      <SectionLabel>{label}</SectionLabel>
      {headerAction}
    </div>
    <Paper elevation={1} className="flex grow flex-col gap-4 p-6">
      {children}
    </Paper>
  </div>
);
