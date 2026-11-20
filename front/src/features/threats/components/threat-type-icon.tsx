import type { ThreatEntityType } from '@app/module/client';
import { ChessKnight, Diamond, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';

/** OpenCTI's glyph for each threat type. */
const THREAT_TYPE_ICONS: Record<ThreatEntityType, LucideIcon> = {
  'intrusion-set': Diamond,
  'threat-actor': Users,
  'campaign': ChessKnight,
};

interface ThreatTypeIconProps {
  entityType: ThreatEntityType,
  size?: number,
}

/** Decorative: the type is always worded next to it. */
export const ThreatTypeIcon: FunctionComponent<ThreatTypeIconProps> = ({ entityType, size }): ReactElement => {
  const Icon = THREAT_TYPE_ICONS[entityType];
  return <Icon aria-hidden size={size ?? 16} className="shrink-0 text-entities-all-threats" />;
};
