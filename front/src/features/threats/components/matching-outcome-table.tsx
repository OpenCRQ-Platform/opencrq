import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { useId } from 'react';
import { OutcomeScoreBadge } from '../../../components/shared';

export interface MatchingOutcomeRow {
  key: string,
  name: string,
  /** Beside the name, outside the link, so it stays out of the link's accessible name. */
  badge?: ReactNode,
  score: number,
  /** The link to the entity's own page, wrapped around its name. */
  renderLink: (name: string) => ReactNode,
}

interface MatchingOutcomeTableProps {
  /** Header of the name column: "Threat" on the outcome page, "Attack outcome" on the threat page. */
  entityColumnLabel: ReactNode,
  rows: ReadonlyArray<MatchingOutcomeRow>,
  footer?: ReactNode,
  /** Rendered above the table and wired as its accessible name; `headingInfo` sits beside it, e.g. a `MetricInfo`. */
  heading?: ReactNode,
  headingInfo?: ReactNode,
  /** Used instead of `heading` when a surrounding title (a `SectionCard`'s) already names the table. */
  ariaLabel?: string,
}

/**
 * The name/probability table of `AttackOutcomeTopThreats`, each row leading to the threat's own
 * page.
 */
export const MatchingOutcomeTable: FunctionComponent<MatchingOutcomeTableProps> = ({
  entityColumnLabel,
  rows,
  footer,
  heading,
  headingInfo,
  ariaLabel,
}) => {
  const labelId = useId();

  return (
    <div>
      {heading && (
        <div className="flex items-center gap-1.5 mb-2">
          <p id={labelId} className="txt-sub-content text-muted-foreground">
            {heading}
          </p>
          {headingInfo}
        </div>
      )}
      <table className="w-full" aria-labelledby={heading ? labelId : undefined} aria-label={heading ? undefined : ariaLabel}>
        <thead>
          <tr>
            <th scope="col" className="txt-sub-content text-muted-foreground text-left font-normal">
              {entityColumnLabel}
            </th>
            <th scope="col" className="txt-sub-content text-muted-foreground text-left font-normal">
              <Trans>Probability</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  {row.renderLink(row.name)}
                  {row.badge}
                </span>
              </td>
              <td className="py-2">
                <OutcomeScoreBadge score={row.score} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
};
