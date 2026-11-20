import type { FunctionComponent } from 'react';

/** One slice of a categorical chart — a bar segment or a pie sector. The colour is the caller's:
 * a status palette where the value has an agreed meaning, `categoricalChartColor` otherwise. */
export interface ChartSegment {
  key: string,
  value: number,
  color: string,
}

interface ChartSwatchProps {
  /** Omitted for the outlined swatch, which stands for absence rather than a value: at this size
   * the band's hatch would read as a smudge, so absence is drawn as an empty dot instead. */
  color?: string,
}

/** The dot a legend row is read against. Decoration: the row's own text carries the meaning. */
export const ChartSwatch: FunctionComponent<ChartSwatchProps> = ({ color }) => (
  <span
    aria-hidden
    className={`inline-block size-2.5 shrink-0 rounded-full ${color === undefined ? 'border border-muted-foreground/40' : ''}`}
    style={color === undefined ? undefined : { backgroundColor: color }}
  />
);
