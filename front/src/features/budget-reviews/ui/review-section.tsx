import type { FunctionComponent, ReactNode } from 'react';
import { SectionCard } from '../../../components/shared';

interface ReviewSectionProps {
  number: number,
  title: ReactNode,
  adornment?: ReactNode,
  action?: ReactNode,
  contentClassName?: string,
  children: ReactNode,
}

export const ReviewSection: FunctionComponent<ReviewSectionProps> = ({ number, title, adornment, action, contentClassName, children }) => (
  <SectionCard
    titleVariant="heading"
    title={(
      <>
        <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--fds-color-filigran-brand-primary-transparency-55)] txt-body2 font-medium text-primary">
          {number}
        </span>
        <span className="min-w-0">{title}</span>
      </>
    )}
    titleAdornment={adornment}
    headerAction={action}
    contentClassName={contentClassName}
  >
    {children}
  </SectionCard>
);
