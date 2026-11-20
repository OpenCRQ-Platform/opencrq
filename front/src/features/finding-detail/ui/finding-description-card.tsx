import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { DossierCard } from './dossier-card';

export const FindingDescriptionCard: FunctionComponent<{ description: string | null }> = ({ description }) => (
  <DossierCard label={t`Description`}>
    {description === null ? (
      <p className="font-content-base text-content-base text-default-secondary">
        <Trans>No description has been ingested for this CVE.</Trans>
      </p>
    ) : (
      <p className="font-content-base text-content-base">{description}</p>
    )}
  </DossierCard>
);
