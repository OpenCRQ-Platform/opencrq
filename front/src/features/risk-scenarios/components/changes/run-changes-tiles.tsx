import { Button, Chip, Icon } from '@filigran/design-system';
import type { ChangeCategoryKey } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { TileReading } from './run-changes-utils';
import { cn } from '../../../../utils';
import { CATEGORY_VIEWS } from './categories';

interface RunChangesTilesProps {
  tiles: ReadonlyArray<TileReading>,
  selected: ReadonlyArray<ChangeCategoryKey>,
  onSelect: (keys: ReadonlyArray<ChangeCategoryKey>) => void,
}

export const RunChangesTiles: FunctionComponent<RunChangesTilesProps> = ({ tiles, selected, onSelect }) => {
  const selectedTiles = tiles.filter((tile) => selected.includes(tile.key));
  const total = (selectedTiles.length === 0 ? tiles : selectedTiles).reduce((sum, tile) => sum + tile.up + tile.down + tile.neutral, 0);
  return (
    <section className="flex flex-col gap-2.5" aria-label={t`Changes by category`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2>{selectedTiles.length === 0 ? <Trans>All changes · {total}</Trans> : <Trans>Selected changes · {total}</Trans>}</h2>
        <Button priority="tertiary" size="sm" className={cn(selected.length === 0 && 'invisible')} onClick={() => onSelect([])}>
          <Trans>Show all</Trans>
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2.5 lg:grid-cols-[repeat(6,minmax(0,1fr))]">
        {tiles.map((tile) => {
          const isSelected = selected.includes(tile.key);
          const empty = tile.up + tile.down + tile.neutral === 0;
          return (
            <button
              key={tile.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? selected.filter((key) => key !== tile.key) : [...selected, tile.key])}
              className={cn(
                'relative flex min-h-19 cursor-pointer flex-col items-start gap-2 rounded-sm border p-[12px_14px] text-left focus-visible:outline-none focus-visible:ring-2 ring-focus',
                isSelected
                  ? 'border-primary bg-primary/10'
                  : 'border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-2)] hover:border-primary/60',
              )}
            >
              {isSelected && <Icon name="check" size={16} aria-hidden className="absolute top-2 right-2 text-primary" />}
              <span className="txt-body2 text-muted-foreground">{CATEGORY_VIEWS[tile.key].label()}</span>
              <span className="flex min-h-6 items-center gap-1.5">
                {empty && <span className="txt-sub-content text-muted-foreground"><Trans>No change</Trans></span>}
                {tile.up > 0 && <Chip label={`↑ ${tile.up}`} severity="critical" className="tabular-nums" />}
                {tile.down > 0 && <Chip label={`↓ ${tile.down}`} severity="low" className="tabular-nums" />}
                {tile.neutral > 0 && <Chip label={`${tile.neutral}`} severity="neutral" className="tabular-nums" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
