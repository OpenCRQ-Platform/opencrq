/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { EllipsisVertical } from 'lucide-react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { CurrentMark, EntityCard } from '../../../components';

export interface TenantCardProps {
  id: string,
  name: string,
  memberCount: number,
  onDelete?: (id: string) => void,
  onRename?: (id: string) => void,
  onNavigate: (id: string) => void,
  isCurrent?: boolean,
}

export const TenantCard: FunctionComponent<TenantCardProps> = ({
  id,
  name,
  memberCount: count,
  onDelete,
  onRename,
  onNavigate,
  isCurrent,
}) => (
  <EntityCard
    title={name}
    data={<span>{t({ message: plural(count, { one: '# member', other: '# members' }) })}</span>}
    badges={[{ title: t`Tenant` }]}
    onClick={() => onNavigate(id)}
    selected={isCurrent}
    actions={(
      <div className="flex items-center gap-2">
        {isCurrent === true && <CurrentMark label={t`Current tenant`} />}
        {(onRename !== undefined || onDelete !== undefined) && (
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            {onRename !== undefined && (
              <IconActionsItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(id);
                }}
              >
                <Trans>Rename</Trans>
              </IconActionsItem>
            )}
            {onDelete !== undefined && (
              <IconActionsItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(id);
                }}
              >
                <Trans>Delete</Trans>
              </IconActionsItem>
            )}
          </IconActions>
        )}
      </div>
    )}
  />
);
