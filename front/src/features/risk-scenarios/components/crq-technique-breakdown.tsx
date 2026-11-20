import type { FunctionComponent } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { CrqRunDetail } from './crq-run-cards';
import { EmptyValue } from '../../../components/ui/empty-value';
import { MetricInfo, SectionCard } from '../../../components/shared';
import { formatDollar } from '../../../utils';
import { FigureFamilyDate } from './figure-family-date';

interface CrqTechniqueBreakdownProps {
  riskScenarioId: string,
  techniques: CrqRunDetail['techniqueWhatIfResults'],
}

export const CrqTechniqueBreakdown: FunctionComponent<CrqTechniqueBreakdownProps> = ({ riskScenarioId, techniques }) => {
  if (techniques.length === 0) {
    return null;
  }

  return (
    <SectionCard
      title={(
        <span className="flex items-center gap-1">
          <Trans>Technique values</Trans>
          <MetricInfo
            title={t`Technique values`}
            what={<Trans>What interdicting each technique is worth: the annual loss the scenario sheds if a control stops it every time, plus what it sheds if its detection is fully covered.</Trans>}
            how={<Trans>The scenario is re-evaluated on the same worlds with the technique still played but never succeeding, then with its detection fully covered, and the two differences are added. Summed over the actors that hold it.</Trans>}
            caveat={<Trans>Each amount is a ceiling measured on that technique alone. Amounts overlap, so they do not add up across techniques and none of them is a share of the scenario's exposure.</Trans>}
          />
        </span>
      )}
      headerAction={<FigureFamilyDate riskScenarioId={riskScenarioId} family="techniques" />}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><span className="txt-container-title"><Trans>Technique</Trans></span></TableHead>
            <TableHead className="text-right"><span className="txt-container-title"><Trans>By preventing it</Trans></span></TableHead>
            <TableHead className="text-right"><span className="txt-container-title"><Trans>By detecting it</Trans></span></TableHead>
            <TableHead className="text-right"><span className="txt-container-title"><Trans>Value of interdicting</Trans></span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {techniques.map((technique) => {
            const { preventValueMean, detectValueMean } = technique;
            const priced = preventValueMean !== null && detectValueMean !== null;
            return (
              <TableRow key={technique.id}>
                <TableCell>
                  <span className="font-medium">{technique.externalId}</span> {technique.name}
                </TableCell>
                <TableCell className="text-right">
                  {priced ? formatDollar(preventValueMean) : <EmptyValue />}
                </TableCell>
                <TableCell className="text-right">
                  {priced ? formatDollar(detectValueMean) : <EmptyValue />}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {priced ? formatDollar(preventValueMean + detectValueMean) : <EmptyValue />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </SectionCard>
  );
};
