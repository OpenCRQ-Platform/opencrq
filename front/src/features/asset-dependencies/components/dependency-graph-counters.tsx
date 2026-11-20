import { plural } from '@lingui/core/macro';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { DependencyGraphModel, DependencyHighlight } from '../dependency-graph-utils';
import { criticalityRingProperty, dependencyHighlights } from '../dependency-graph-utils';
import { cn } from '../../../utils';

interface DependencyGraphCountersProps {
  model: DependencyGraphModel,
  assetCount: number,
  selectedId: string | null,
  /** A chip selects its asset on the graph, whose panel is where the asset is opened from. */
  onSelect: (id: string | null) => void,
  /** The three readings are the dependency chain's: an identity is no asset anyone owns. */
  countsAlone?: boolean,
}

interface Counter {
  key: string,
  label: string,
  assets: Array<DependencyHighlight>,
}

interface AssetChipProps {
  asset: DependencyHighlight,
  selected: boolean,
  onSelect: (id: string | null) => void,
}

const AssetChip: FunctionComponent<AssetChipProps> = ({ asset, selected, onSelect }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={() => onSelect(selected ? null : asset.id)}
    className={cn(
      'flex h-6 items-center gap-1.5 rounded-full border px-2.5 txt-sub-content',
      selected ? 'border-primary bg-primary/20 text-primary' : 'border-elevation-subtle-soft hover:bg-hover',
    )}
  >
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full border-2"
      style={{ borderColor: `var(${criticalityRingProperty(asset.criticality)})` }}
    />
    {asset.label}
  </button>
);

/**
 * The three readings of the drawn chain, each opening on the assets it counts. One at a time: the
 * chips wrap, and two lists open at once push the canvas out of the card.
 */
export const DependencyGraphCounters: FunctionComponent<DependencyGraphCountersProps> = ({
  model,
  assetCount,
  selectedId,
  onSelect,
  countsAlone,
}) => {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const highlights = dependencyHighlights(model);
  const counters: Array<Counter> = [
    { key: 'critical', label: plural(highlights.critical.length, { one: '# critical', other: '# critical' }), assets: highlights.critical },
    { key: 'exposed', label: plural(highlights.exposed.length, { one: '# exposed', other: '# exposed' }), assets: highlights.exposed },
    { key: 'unowned', label: plural(highlights.unowned.length, { one: '# unowned', other: '# unowned' }), assets: highlights.unowned },
  ].filter((counter) => countsAlone !== true && counter.assets.length > 0);
  const opened = counters.find((counter) => counter.key === openKey);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <span className="px-2 text-default-secondary txt-sub-content">
          {plural(assetCount, { one: '# supporting asset', other: '# supporting assets' })}
        </span>
        {counters.map((counter) => {
          const isOpen = counter.key === openKey;
          return (
            <button
              key={counter.key}
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenKey(isOpen ? null : counter.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 txt-sub-content',
                isOpen ? 'bg-hover font-semibold' : 'font-medium hover:bg-hover',
              )}
            >
              {isOpen
                ? <ChevronDown className="size-3" aria-hidden />
                : <ChevronRight className="size-3" aria-hidden />}
              {counter.label}
            </button>
          );
        })}
      </div>
      {opened !== undefined && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          {opened.assets.map((asset) => (
            <AssetChip key={asset.id} asset={asset} selected={asset.id === selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
};
