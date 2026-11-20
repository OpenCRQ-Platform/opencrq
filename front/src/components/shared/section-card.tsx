import { Paper, Text } from '@filigran/design-system';
import type { FunctionComponent, KeyboardEvent, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../utils';

/**
 * `label` captions the card from above in small type, `heading` titles a page section from above at
 * section-title size, `inside` sets that section title within the card.
 */
type SectionCardTitleVariant = 'label' | 'heading' | 'inside';

interface SectionCardBaseProps {
  title: ReactNode,
  children: ReactNode,
  className?: string,
  cardClassName?: string,
  /** Applied to the card body, so a stretched card can lay its own content out over the full height. */
  contentClassName?: string,
  interactive?: boolean,
  onClick?: () => void,
  headerAction?: ReactNode,
  /** Raised to 2 for a card held by a panel that is itself a surface. */
  elevation?: 1 | 2,
}

type SectionCardProps = SectionCardBaseProps & (
  | { titleVariant?: 'label', titleAdornment?: never }
  | {
    titleVariant: 'heading' | 'inside',
    /** Set beside the title, outside the heading element: a chip, a count, an info. */
    titleAdornment?: ReactNode,
  }
);

interface HeaderProps {
  titleId: string,
  title: ReactNode,
  variant: SectionCardTitleVariant,
  titleAdornment: ReactNode,
  headerAction: ReactNode,
}

const SectionCardHeader: FunctionComponent<HeaderProps> = ({ titleId, title, variant, titleAdornment, headerAction }) => {
  if (variant === 'label') {
    return headerAction ? (
      <div className="flex items-center justify-between">
        <p id={titleId} className="txt-sub-content">{title}</p>
        {headerAction}
      </div>
    ) : (
      <p id={titleId} className="txt-sub-content">{title}</p>
    );
  }
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Text variant="title-md" as="h2" id={titleId} className="flex min-w-0 items-center gap-3">{title}</Text>
        {titleAdornment}
      </div>
      {headerAction}
    </div>
  );
};

export const SectionCard: FunctionComponent<SectionCardProps> = ({
  title,
  children,
  className,
  cardClassName,
  contentClassName,
  interactive,
  onClick,
  headerAction,
  elevation,
  titleVariant,
  titleAdornment,
}) => {
  const titleId = useId();
  const variant = titleVariant ?? 'label';
  const header = (
    <SectionCardHeader titleId={titleId} title={title} variant={variant} titleAdornment={titleAdornment} headerAction={headerAction} />
  );
  const content = (
    <div className={cn('flex flex-col gap-6', contentClassName)}>
      {children}
    </div>
  );
  return (
    <div className={cn('flex flex-col', variant === 'heading' ? 'gap-3' : 'gap-2', className)}>
      {variant !== 'inside' && header}
      <Paper
        elevation={elevation}
        className={cn(interactive && 'cursor-pointer hover:bg-elevation-hover transition-colors', cardClassName)}
        onClick={onClick}
        {...(onClick && {
          role: 'button' as const, tabIndex: 0, 'aria-labelledby': titleId, onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault(); onClick();
            }
          },
        })}
      >
        {variant === 'inside'
          ? (
            <div className="flex h-full flex-col gap-4">
              {header}
              {content}
            </div>
          )
          : content}
      </Paper>
    </div>
  );
};
