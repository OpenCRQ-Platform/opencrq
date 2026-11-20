import type { FunctionComponent } from 'react';
import { EntityCard } from '../../../components';
import { EMPTY_VALUE } from '../../../utils/empty-value';

export interface AttackOutcomeCardProps {
  id: string,
  name: string,
  description: string | null,
  onNavigate: (id: string) => void,
}

export const AttackOutcomeCard: FunctionComponent<AttackOutcomeCardProps> = ({
  id,
  name,
  description,
  onNavigate,
}) => (
  <EntityCard
    title={name}
    description={description ?? EMPTY_VALUE}
    onClick={() => onNavigate(id)}
  />
);
