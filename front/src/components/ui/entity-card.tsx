import { Card, CardDescription, CardFooter, CardHeader, CardTitle, Text, Thumbnail } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import type { BadgeGroupItem } from './badge-group';
import { cn } from '../../utils';
import { BadgeGroup } from './badge-group';

export interface EntityCardLogo {
  src: string,
  alt: string,
}

export interface EntityCardProps {
  title: string,
  /** Merged onto the card, for callers that own their body's vertical rhythm. */
  className?: string,
  onClick?: () => void,
  actions?: ReactNode,
  logo?: EntityCardLogo,
  description?: string | null,
  data?: ReactNode,
  badges?: Array<BadgeGroupItem>,
  /**
   * Repaints the surface only. The design system pairs it with a Checkbox in the action slot and
   * treats the paint as reinforcement, so a caller setting this owns putting a visible mark there.
   */
  selected?: boolean,
}

export const EntityCard: FunctionComponent<EntityCardProps> = ({
  title,
  className,
  onClick,
  actions,
  logo,
  description,
  data,
  badges,
  selected,
}) => (
  <Card
    onClick={onClick}
    selected={selected}
    className={cn('h-full', className)}
  >
    <CardHeader
      icon={logo && (
        <Thumbnail>
          <img src={logo.src} alt={logo.alt} className="size-full object-contain" />
        </Thumbnail>
      )}
      action={actions}
    >
      <CardTitle as="h3">{title}</CardTitle>
    </CardHeader>
    {description != null && description !== '' && (
      <CardDescription>{description}</CardDescription>
    )}
    {data && (
      <Text as="div" variant="content-compact" className="text-default-secondary">
        {data}
      </Text>
    )}
    {badges != null && badges.length > 0 && (
      <CardFooter className="mt-auto">
        <BadgeGroup items={badges} />
      </CardFooter>
    )}
  </Card>
);
