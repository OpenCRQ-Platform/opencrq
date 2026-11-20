import { Paper, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { ProtectingControl, ProtectingTechnique, Verdicts } from '../protected-by-utils';
import { ControlIdPill, DisplayDrawer, TooltipHintProvider } from '../../../components/shared';
import { ProofMeter } from '../../controls/capability/ui/proof-meter';
import { MonoChip } from '../../finding-detail/ui/mono-chip';
import { cn, EMPTY_VALUE, formatDate } from '../../../utils';
import { fleetTotal, isTestedScope, splitByTesting, tallyLetThrough, testedTechniqueIds } from '../protected-by-utils';
import { CoverageCell, EffectivenessCell, StrengthCell, VerdictChip, verdictReadings } from './protecting-control-cells';

const BORDER = 'border-[color:var(--fds-border-elevation-subtle-soft)]';

const Caption: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
    {children}
  </span>
);

const techniqueCountText = (count: number): string => plural(count, { one: '# technique', other: '# techniques' });

const PostureTile: FunctionComponent<{ label: string, children: ReactNode }> = ({ label, children }) => (
  <Paper elevation={1} className="flex flex-col gap-2.5 p-4">
    <Caption>{label}</Caption>
    {children}
  </Paper>
);

/** Outside any scope every value is the tenant's own, so no provenance is stated. */
const PostureTiles: FunctionComponent<{ control: ProtectingControl, scopeSelected: boolean }> = ({ control, scopeSelected }) => {
  const inherited = control.strengthSource === 'tenant' && control.coverageSource === 'tenant';
  const notesInherited = scopeSelected && !inherited;
  return (
    <div className="flex flex-col gap-2.5">
      <Caption><Trans>Declared posture</Trans></Caption>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
        <PostureTile label={t`Strength`}><StrengthCell control={control} notesInherited={notesInherited} /></PostureTile>
        <PostureTile label={t`Coverage`}><CoverageCell control={control} notesInherited={notesInherited} /></PostureTile>
        <PostureTile label={t`Effectiveness`}><EffectivenessCell control={control} /></PostureTile>
      </div>
      {scopeSelected && control.assessed && inherited && (
        <span className="txt-sub-content text-muted-foreground"><Trans>Inherited from the tenant</Trans></span>
      )}
    </div>
  );
};

const ProofTile: FunctionComponent<{
  label: string,
  verdicts: Verdicts | null,
  neverTestedLabel: string,
  caption: string,
}> = ({ label, verdicts, neverTestedLabel, caption }) => (
  <Paper elevation={1} className="flex flex-col gap-2.5 p-4">
    <Caption>{label}</Caption>
    {verdicts === null ? (
      <span className="text-muted-foreground">{neverTestedLabel}</span>
    ) : (
      <>
        {verdictReadings(verdicts).map((reading) => (
          <div key={reading.key} className="flex flex-col gap-2.5">
            <span><VerdictChip reading={reading} /></span>
            <ProofMeter ratio={reading.tally.held / reading.tally.total} tone={tallyLetThrough(reading.tally) ? 'warning' : 'positive'} />
          </div>
        ))}
        <span className="txt-sub-content text-muted-foreground">{caption}</span>
      </>
    )}
  </Paper>
);

const ProofTiles: FunctionComponent<{ control: ProtectingControl }> = ({ control }) => {
  const here = control.testedHere;
  const hereCaption = here === null
    ? ''
    : [techniqueCountText(testedTechniqueIds(control).length), ...(here.lastRunAt === null ? [] : [formatDate(here.lastRunAt)])].join(' · ');
  const fleet = fleetTotal(control);
  return (
    <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
      <ProofTile label={t`Tested on this asset`} verdicts={here} neverTestedLabel={t`Never tested here`} caption={hereCaption} />
      <ProofTile
        label={t`Tested in the fleet`}
        verdicts={fleet.techniqueCount === 0 ? null : fleet.verdicts}
        neverTestedLabel={t`Never tested anywhere`}
        caption={techniqueCountText(fleet.techniqueCount)}
      />
    </div>
  );
};

const TechniqueName: FunctionComponent<{ technique: ProtectingTechnique }> = ({ technique }) => (
  <span className="flex min-w-0 items-center gap-2">
    <MonoChip>{technique.externalId}</MonoChip>
    <span className="font-content-base text-content-base">{technique.name ?? technique.externalId}</span>
  </span>
);

const ReadingCell: FunctionComponent<{ verdicts: Verdicts, caption: string | null }> = ({ verdicts, caption }) => {
  if (!isTestedScope(verdicts)) {
    return <span className="text-muted-foreground">{EMPTY_VALUE}</span>;
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap gap-1">
        {verdictReadings(verdicts).map((reading) => <VerdictChip key={reading.key} reading={reading} />)}
      </span>
      {caption !== null && <span className="txt-sub-content text-muted-foreground">{caption}</span>}
    </span>
  );
};

const TestedTechniques: FunctionComponent<{ techniques: Array<ProtectingTechnique> }> = ({ techniques }) => {
  const testedCount = techniques.length;
  return (
    <table className={cn('w-full border-collapse border-b', BORDER)}>
      <thead>
        <tr className="text-left">
          <th className="h-8 pr-4 font-normal"><Caption><Trans>Tested techniques ({testedCount})</Trans></Caption></th>
          <th className="w-[140px] pr-4 font-normal"><Caption><Trans>On this asset</Trans></Caption></th>
          <th className="w-[140px] font-normal"><Caption><Trans>In the fleet</Trans></Caption></th>
        </tr>
      </thead>
      <tbody>
        {techniques.map((technique) => {
          const hereRunAt = technique.here.lastRunAt;
          const fleetAssetCount = technique.fleet.assetCount;
          return (
            <tr key={technique.mitreTechniqueId} className={cn('border-t', BORDER)}>
              <td className="py-2 pr-4"><TechniqueName technique={technique} /></td>
              <td className="py-2 pr-4">
                <ReadingCell verdicts={technique.here} caption={hereRunAt === null ? null : formatDate(hereRunAt)} />
              </td>
              <td className="py-2">
                <ReadingCell
                  verdicts={technique.fleet}
                  caption={plural(fleetAssetCount, { one: 'on # asset', other: 'on # assets' })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const NeverTestedTechniques: FunctionComponent<{ techniques: Array<ProtectingTechnique> }> = ({ techniques }) => {
  const neverTestedCount = techniques.length;
  return (
    <div className="flex flex-col gap-2.5">
      <Caption><Trans>Never tested ({neverTestedCount})</Trans></Caption>
      <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-6 gap-y-2.5">
        {techniques.map((technique) => (
          <li key={technique.mitreTechniqueId} className="flex min-w-0 items-center gap-2 text-default-secondary">
            <MonoChip>{technique.externalId}</MonoChip>
            <span className="font-content-compact text-content-compact">{technique.name ?? technique.externalId}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const CoveredTechniques: FunctionComponent<{ techniques: Array<ProtectingTechnique> }> = ({ techniques }) => {
  const techniqueCount = techniques.length;
  return (
    <div className="flex flex-col">
      <span className="flex h-8 items-center"><Caption><Trans>Techniques ({techniqueCount})</Trans></Caption></span>
      <ul className={cn('flex flex-col border-y', BORDER)}>
        {techniques.map((technique) => (
          <li key={technique.mitreTechniqueId} className={cn('flex min-h-11 items-center border-t first:border-t-0', BORDER)}>
            <TechniqueName technique={technique} />
          </li>
        ))}
      </ul>
    </div>
  );
};

const OpenAevResults: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <section className={cn('flex flex-col gap-4 rounded-[var(--fds-radius-sm)] border p-[16px_20px_20px]', BORDER)}>
    <h3 className="flex items-center gap-2.5">
      <img src="/img/icon-openaev.png" alt="" className="size-5" />
      <span className="txt-category"><Trans>OpenAEV results</Trans></span>
      <TooltipHintProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t`About the OpenAEV results`}
              className="inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-[var(--fds-radius-sm)] border-0 bg-transparent p-0 text-default-secondary hover:text-default-primary"
            >
              <Info className="size-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-75">
            <Trans>
              Attacks OpenAEV simulated on the techniques this control covers, read from the security platforms that implement it.
              “Prevented 1/2”: one attack in two was blocked. The fleet gathers every asset of the scope.
            </Trans>
          </TooltipContent>
        </Tooltip>
      </TooltipHintProvider>
    </h3>
    {children}
  </section>
);

interface ProtectingControlDrawerProps {
  control: ProtectingControl | null,
  tenantId: string,
  scopeSelected: boolean,
  onClose: () => void,
}

export const ProtectingControlDrawer: FunctionComponent<ProtectingControlDrawerProps> = ({ control, tenantId, scopeSelected, onClose }) => {
  if (control === null) {
    return null;
  }
  const { tested, neverTested } = splitByTesting(control);
  return (
    <DisplayDrawer
      open
      onClose={onClose}
      category={<ControlIdPill externalId={control.externalId} />}
      // The first focusable element is the info icon of the OpenAEV results, whose tooltip would open on every opening.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.focus();
        }
      }}
      title={(
        <Link
          to="/$tenantId/{-$organizationId}/controls/$controlId/overview"
          params={{ tenantId, controlId: control.capabilityId }}
          className="text-primary underline-offset-4 hover:underline"
        >
          {control.name}
        </Link>
      )}
    >
      <div className="flex flex-col gap-6 overflow-y-auto">
        <PostureTiles control={control} scopeSelected={scopeSelected} />
        {control.testable ? (
          <OpenAevResults>
            <ProofTiles control={control} />
            {tested.length > 0 && <TestedTechniques techniques={tested} />}
            {neverTested.length > 0 && <NeverTestedTechniques techniques={neverTested} />}
          </OpenAevResults>
        ) : (
          <>
            <OpenAevResults>
              <span className="text-muted-foreground"><Trans>Not testable by OpenAEV</Trans></span>
            </OpenAevResults>
            <CoveredTechniques techniques={control.standsOn} />
          </>
        )}
      </div>
    </DisplayDrawer>
  );
};
