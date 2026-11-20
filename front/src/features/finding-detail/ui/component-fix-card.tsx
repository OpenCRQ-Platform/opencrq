import { Paper } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { ComponentFix } from '../remediation-utils';
import { ReferenceLink } from './reference-link';

/**
 * One affected component: what it is, what to move to, and where the vendor said so.
 *
 * Affected ranges never appear. The product holds no installed version for the asset, so it cannot
 * say which release line a machine runs, and the vendor advisory answers that better than a grid of
 * bounds would.
 */
export const ComponentFixCard: FunctionComponent<{ fix: ComponentFix }> = ({ fix }) => (
  <Paper elevation={1} className="flex flex-col gap-4 p-6">
    <div className="font-content-title-sm text-content-title-sm">
      {fix.vendor !== null && fix.vendor !== fix.name && (
        <span className="font-content-base text-content-base text-default-secondary">{`${fix.vendor} `}</span>
      )}
      {fix.name ?? <Trans>Unnamed component</Trans>}
    </div>

    {fix.targetVersion !== null && (
      <div className="flex flex-col gap-0.5">
        <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
          <Trans>Move to</Trans>
        </span>
        <span className="font-content-code text-content-code text-[length:var(--fds-text-4)] font-medium tabular-nums">
          {fix.targetVersion}
        </span>
      </div>
    )}

    {fix.vendorLines.length > 0 && (
      <div
        className="flex flex-col gap-1 border-l-2 pl-3 font-content-base text-content-base"
        style={{ borderColor: 'var(--fds-border-elevation-subtle)' }}
      >
        {fix.vendorLines.map((line) => <span key={line}>{line}</span>)}
      </div>
    )}

    {fix.targetVersion === null && fix.vendorLines.length === 0 && (
      <p className="font-content-base text-content-base text-default-secondary">
        <Trans>The record names this component as affected without naming a version that carries the fix.</Trans>
      </p>
    )}

    {fix.references.length > 0 && (
      <div className="flex flex-col gap-3">
        {fix.references.map((reference) => (
          <ReferenceLink key={reference.url} reference={reference} />
        ))}
      </div>
    )}
  </Paper>
);
