import { Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { RankedRow } from '../components/slick-primitives';
import { MetricInfo } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { formatFractionAsPercent, getCvssSeverity } from '../../../utils';
import { Panel, RankedList } from '../components/slick-primitives';

interface SlickLeverageWidgetProps {
  organizationId?: string,
}

/**
 * The other axis on the same estate: not "how bad is this one finding" but "how many findings does
 * one fix close".
 *
 * A CVE on forty assets is one patch and forty closures. That is the cheapest work available and no
 * severity ranking will surface it, which is why this panel exists beside the triage queue rather
 * than as a variant of it.
 */
export const SlickLeverageWidget: FunctionComponent<SlickLeverageWidgetProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.dashboard.getFindingsOverview.queryOptions({ organizationId }));

  const cves = data?.topCves ?? [];
  // Bars are scaled against the widest-spread CVE on screen, so the leading row is full width and
  // every other row reads as a fraction of it.
  const peak = Math.max(...cves.map((cve) => cve.impactedAssetCount), 0);

  const rows: Array<RankedRow> = cves.map((cve) => {
    const severity = getCvssSeverity(cve.cvss);
    const assetCount = cve.impactedAssetCount;
    // Hoisted: `<Trans>` needs a plain identifier, not a call, to produce a stable message id.
    const epss = cve.epss === null ? null : formatFractionAsPercent(cve.epss, 1);
    return {
      id: cve.cveId,
      label: cve.cveId,
      value: String(assetCount),
      valueMeta: plural(assetCount, { one: 'asset', other: 'assets' }),
      ratio: peak > 0 ? assetCount / peak : null,
      meta: (
        <span className="flex shrink-0 items-center gap-1">
          {cve.kev && (
            <Chip severity="critical" label={t`KEV`} />
          )}
          {severity && <Chip severity={severity.tone} label={severity.label} />}
          {epss !== null && (
            <span className="txt-mini text-muted-foreground">
              <Trans>EPSS {epss}</Trans>
            </span>
          )}
        </span>
      ),
      onClick: () => {
        void navigate({
          to: '/$tenantId/{-$organizationId}/settings/taxonomies/cve/$cveId',
          params: (prev) => ({ tenantId: prev.tenantId ?? '', cveId: cve.cveId }),
        });
      },
    };
  });

  const cleared = cves.reduce((sum, cve) => sum + cve.impactedAssetCount, 0);

  return (
    <Panel
      title={<Trans>Patch leverage</Trans>}
      info={
        <MetricInfo
          title={t`Patch leverage`}
          what={<Trans>The CVEs where a single fix closes findings on the most assets.</Trans>}
          how={
            <Trans>
              Active findings grouped by CVE and ranked by how many distinct assets carry it, so the
              figure is the number of findings one patch would close. Where the same CVE reaches an
              asset from several sources the most recent record wins, so an asset is counted once.
              Severity chips show the highest CVSS and EPSS recorded for that CVE across the estate.
            </Trans>
          }
          caveat={
            <Trans>
              Spread is not severity. A widely deployed low-severity CVE will outrank a critical one
              sitting on a single host, which is the point, but it means this list must be read
              beside Fix these first, never instead of it. Nor does spread imply one fix is
              available: the same CVE across mixed versions can need several.
            </Trans>
          }
        />
      }
    >
      <RankedList
        rows={rows}
        isLoading={data === undefined}
        empty={<Trans>No active finding.</Trans>}
        barClassName="bg-amber-600/60 dark:bg-amber-400/60"
      />
      {cves.length > 0 && (
        <p className="txt-sub-content text-muted-foreground border-t pt-2.5">
          <Plural
            value={cleared}
            one="These fixes would close # finding across the estate."
            other="These fixes would close # findings across the estate."
          />
        </p>
      )}
    </Panel>
  );
};
