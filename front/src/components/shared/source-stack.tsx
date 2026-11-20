import { t } from '@lingui/core/macro';
import { UserRound } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { getConnectorIconBySource, getConnectorNameBySource } from '../../features/integrations';

interface SourceStackProps {
  /** The reporting connectors' own slugs; empty for an asset or finding set by a person. */
  sources: ReadonlyArray<string>,
  className?: string,
}

/**
 * The one provenance mark shared by the assets list, the findings list, both detail banners and
 * the finding's Asset card: connector icons overlap left over right, the leftmost on top, each
 * titled with the connector name, once per connector however many of its sources report it. A
 * person glyph replaces the stack when nothing reports it.
 */
export const SourceStack: FunctionComponent<SourceStackProps> = ({ sources: reported, className }) => {
  const sources = [...new Set(reported)];
  if (sources.length === 0) {
    return (
      <span title={t`Set by user`} className={className}>
        <UserRound className="h-4 w-4 text-muted-foreground" aria-label={t`Set by user`} />
      </span>
    );
  }

  return (
    <div className={`flex items-center ${className ?? ''}`}>
      {sources.map((source, index) => {
        const name = getConnectorNameBySource(source) ?? source;
        const icon = getConnectorIconBySource(source);
        return (
          <span
            key={source}
            title={name}
            className="relative -ml-1.5 flex first:ml-0"
            style={{ zIndex: sources.length - index }}
          >
            {icon === null
              ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] ring-2 ring-background">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )
              : <img src={icon} alt={name} className="h-5 w-5 rounded-full bg-background object-contain ring-2 ring-background" />}
          </span>
        );
      })}
    </div>
  );
};
