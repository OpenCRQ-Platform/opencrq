import { EllipsisVertical } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { RevenueBand } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { formatCompactCount, formatRevenueBand } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { CurrentMark, EntityCard } from '../../../components';
import { ScopePinButton } from './scope-pin-button';

export interface OrganizationCardProps {
  id: string,
  name: string,
  description: string | null,
  sector: { id: string, name: string } | null,
  country: { id: string, name: string } | null,
  employeeCount: number | null,
  revenueBand: RevenueBand | null,
  estate: string,
  onDelete: (id: string) => void,
  onNavigate: (id: string) => void,
  pinned: boolean,
  onPinnedChange: (pinned: boolean) => void,
  isCurrent?: boolean,
}

export const OrganizationCard: FunctionComponent<OrganizationCardProps> = ({
  id,
  name,
  description,
  sector,
  country,
  employeeCount,
  revenueBand,
  estate,
  onDelete,
  onNavigate,
  pinned,
  onPinnedChange,
  isCurrent,
}) => {
  const badges: Array<{ title: string }> = [{ title: estate }];
  if (sector) {
    badges.push({ title: sector.name });
  }
  if (country) {
    badges.push({ title: country.name });
  }
  return (
    <EntityCard
      title={name}
      description={description ?? EMPTY_VALUE}
      data={
        <>
          {formatCompactCount(employeeCount)}
          {' '}
          {t`employees`}
          {' · '}
          {formatRevenueBand(revenueBand)}
        </>
      }
      badges={badges}
      onClick={() => onNavigate(id)}
      selected={isCurrent}
      actions={(
        <div className="flex items-center gap-2">
          {isCurrent === true && <CurrentMark label={t`Current scope`} />}
          <ScopePinButton pinned={pinned} onToggle={onPinnedChange} />
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete(id);
              }}
            >
              <Trans>Delete</Trans>
            </IconActionsItem>
          </IconActions>
        </div>
      )}
    />
  )
};
