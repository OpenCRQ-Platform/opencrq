import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { CvssSeverityLevel, DismissalType, EvidenceHistoryOrigin } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { FlawKind } from '../dismissal-vocabulary';
import { dismissedStateLabel } from '../dismissal-vocabulary';
import { CVSS_SEVERITY_TONES, getCvssSeverityLabel } from '../../../utils';

/** CVSS severity, never the finding's own band: the two vocabularies stay apart on this page. */
export const CvssSeverityChip: FunctionComponent<{ level: CvssSeverityLevel }> = ({ level }) => (
  <Chip severity={CVSS_SEVERITY_TONES[level]} label={getCvssSeverityLabel(level)} />
);

export const KevChip: FunctionComponent<{ listed: boolean }> = ({ listed }) => (
  listed
    ? <Chip severity="critical" label={t`Listed`} />
    : <Chip severity="neutral" label={t`Not listed`} />
);

/**
 * The finding's state, worded after what dismissed it: a connector's verdict, or a person's
 * decision, by the type that decision was recorded under when it has one.
 */
export const EvidenceStateChip: FunctionComponent<{
  state: 'applicable' | 'dismissed',
  kind: FlawKind,
  /** Of the latest history row. */
  origin: EvidenceHistoryOrigin | null,
  dismissalType: DismissalType | null,
}> = ({ state, kind, origin, dismissalType }) => {
  if (state === 'applicable') {
    return <Chip severity="critical" label={t`Applicable`} />;
  }
  return <Chip severity="neutral" label={dismissedStateLabel({ kind, origin, dismissalType })} />;
};
