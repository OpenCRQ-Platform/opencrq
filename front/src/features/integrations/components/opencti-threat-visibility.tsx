import { Chip, RadioGroup } from '@filigran/design-system';
import { OPENCTI_THREAT_VISIBILITIES } from '@app/module/client';
import type { OpenctiThreatVisibility } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { Control, FieldValues, Path } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { CardField, RadioCard } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { ConnectorBanner } from './connector-banner';

const isThreatVisibility = (value: string): value is OpenctiThreatVisibility =>
  (OPENCTI_THREAT_VISIBILITIES as ReadonlyArray<string>).includes(value);

const threatVisibilityLabel = (visibility: OpenctiThreatVisibility): string => (
  visibility === 'per_member' ? t`By each member's rights in OpenCTI` : t`As the service account`
);

/**
 * The tenant's choice, `undefined` until it is read, and whether OpenCTI can be asked as a member.
 * `perMemberUnavailable` only on XTM One's word that OpenCTI is not registered with it: any other
 * failure, of either read, leaves the page quiet.
 */
export const useOpenctiThreatVisibility = () => {
  const trpc = useTRPC();
  const { data: saved } = useQuery(trpc.opencti.getThreatVisibility.queryOptions(undefined, { retry: false }));
  const { data: readerLink } = useQuery(trpc.opencti.getReaderLink.queryOptions(undefined, { retry: false }));
  const visibility: OpenctiThreatVisibility | undefined = saved?.threatVisibility;
  const perMemberUnavailable = readerLink?.link === 'not_linked';
  return { visibility, perMemberUnavailable, hidesMarkedThreats: visibility === 'per_member' && perMemberUnavailable };
};

/** Above the tabs, as the stream's alarm: until someone acts, the members read only unmarked threats. */
export const OpenctiThreatVisibilityBanner: FunctionComponent = () => {
  const { hidesMarkedThreats } = useOpenctiThreatVisibility();
  if (!hidesMarkedThreats) {
    return null;
  }
  return (
    <ConnectorBanner severity="warning" title={<Trans>Marked threats are hidden from members</Trans>}>
      <Trans>This OpenCTI is not linked to OpenCRQ's XTM One, so it does not recognize the members. Link it to the same XTM One, or choose in Configure what members see.</Trans>
    </ConnectorBanner>
  );
};

export const OpenctiThreatVisibilityField: FunctionComponent<{ className?: string }> = ({ className }) => {
  const { visibility, hidesMarkedThreats } = useOpenctiThreatVisibility();
  return (
    <CardField title={t`Threat visibility`} className={className}>
      <span className="flex flex-wrap items-center gap-2">
        {visibility ? <span>{threatVisibilityLabel(visibility)}</span> : <EmptyValue />}
        {hidesMarkedThreats && <Chip label={t`Unavailable`} severity="medium" />}
      </span>
    </CardField>
  );
};

/** The choice in the Configure drawer; the per-member one is greyed out while OpenCTI cannot answer for a member. */
export const ThreatVisibilityFields = <T extends FieldValues & { threatVisibility: OpenctiThreatVisibility }>({
  control,
  perMemberUnavailable,
}: { control: Control<T>, perMemberUnavailable: boolean }) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a key T is declared to hold
  const name = 'threatVisibility' as Path<T>;
  return (
    <div className="flex flex-col gap-4">
      <span className="txt-category">{t`Threat visibility`}</span>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <RadioGroup
            value={field.value}
            onValueChange={(value) => {
              if (isThreatVisibility(value)) {
                field.onChange(value);
              }
            }}
            aria-label={t`Threat visibility`}
            className="flex flex-col gap-3"
          >
            <RadioCard
              value="per_member"
              title={threatVisibilityLabel('per_member')}
              description={t`Each member sees the threats they can read in OpenCTI.`}
              disabled={perMemberUnavailable}
              note={perMemberUnavailable && (
                <span className="flex items-center gap-1.5" style={{ color: 'var(--fds-color-feedback-warning-primary)' }}>
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                  <Trans>This OpenCTI is not linked to OpenCRQ's XTM One.</Trans>
                </span>
              )}
            />
            <RadioCard
              value="service_account"
              title={threatVisibilityLabel('service_account')}
              description={t`Every member of the tenant sees what the connector reads in OpenCTI, whatever their own rights there.`}
            />
          </RadioGroup>
        )}
      />
    </div>
  );
};
