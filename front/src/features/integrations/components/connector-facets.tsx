import { Checkbox, Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { CONNECTOR_SCOPE_KINDS, CONNECTOR_STATES } from '@app/module/client';
import type { ConnectorDomain, ConnectorScopeKind, ConnectorState } from '@app/module/client';
import { Activity, Boxes, Layers } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { ConnectorFacetCounts, ConnectorFilters } from '../connector-list-utils';
import { DOMAIN_ORDER } from '../connector-list-utils';
import {
  connectorDomainLabel,
  connectorScopeKindLabel,
  connectorStateLabel,
} from '../connector-vocabulary';

/**
 * `unavailable` is what a connector reads when the deployment carries no credentials, which is the
 * definition of the other tab: it can never appear where this group renders.
 */
const DEPLOYED_STATES = CONNECTOR_STATES.filter((state) => state !== 'unavailable');

const toggle = <V extends string>(selected: ReadonlyArray<V>, value: V): Array<V> =>
  (selected.includes(value) ? selected.filter((held) => held !== value) : [...selected, value]);

interface FacetGroupProps<V extends string> {
  title: string,
  icon: ReactNode,
  values: ReadonlyArray<V>,
  label: (value: V) => string,
  counts: ReadonlyMap<V, number>,
  selected: ReadonlyArray<V>,
  onToggle: (value: V) => void,
}

const FacetGroup = <V extends string>({
  title,
  icon,
  values,
  label,
  counts,
  selected,
  onToggle,
}: FacetGroupProps<V>): ReactNode => (
  <div className="flex flex-col gap-2">
    <span className="flex items-center gap-2">
      <span className="text-[var(--fds-color-filigran-brand-primary)]" aria-hidden="true">{icon}</span>
      <span className="font-title-xs text-title-xs">{title}</span>
    </span>
    {values.map((value) => {
      const count = counts.get(value) ?? 0;
      const isChecked = selected.includes(value);
      // A row nothing would match stays visible but inert: the vocabulary is part of what the page teaches.
      const isInert = count === 0 && !isChecked;
      return (
        <span key={value} className="flex items-center gap-2">
          <Checkbox
            checked={isChecked}
            disabled={isInert}
            onCheckedChange={() => onToggle(value)}
            label={label(value)}
          />
          <span
            className={`font-content-compact text-content-compact ml-auto tabular-nums ${isInert ? 'text-default-disabled' : 'text-default-secondary'}`}
          >
            {count}
          </span>
        </span>
      );
    })}
  </div>
);

/**
 * Domain and scope on both tabs, status only where it varies: the catalogue tab holds one state for
 * every connector on it. The ingestion mechanism is deliberately not among them: it splits six
 * connectors against one, which is a label, and every card already carries it.
 */
export const ConnectorFacets: FunctionComponent<{
  counts: ConnectorFacetCounts,
  filters: ConnectorFilters,
  onChange: (filters: ConnectorFilters) => void,
  withStatus: boolean,
}> = ({ counts, filters, onChange, withStatus }) => (
  <Paper elevation={1} as="aside" aria-label={t`Filters`} className="flex flex-col gap-5 p-4">
    <FacetGroup<ConnectorDomain>
      title={t`Domain`}
      icon={<Layers className="size-4" />}
      values={DOMAIN_ORDER}
      label={connectorDomainLabel}
      counts={counts.domains}
      selected={filters.domains}
      onToggle={(value) => onChange({ ...filters, domains: toggle(filters.domains, value) })}
    />
    <FacetGroup<ConnectorScopeKind>
      title={t`Scope`}
      icon={<Boxes className="size-4" />}
      values={CONNECTOR_SCOPE_KINDS}
      label={connectorScopeKindLabel}
      counts={counts.scopeKinds}
      selected={filters.scopeKinds}
      onToggle={(value) => onChange({ ...filters, scopeKinds: toggle(filters.scopeKinds, value) })}
    />
    {withStatus && (
      <FacetGroup<ConnectorState>
        title={t`Status`}
        icon={<Activity className="size-4" />}
        values={DEPLOYED_STATES}
        label={connectorStateLabel}
        counts={counts.states}
        selected={filters.states}
        onToggle={(value) => onChange({ ...filters, states: toggle(filters.states, value) })}
      />
    )}
  </Paper>
);
