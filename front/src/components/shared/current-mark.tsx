import { Check } from 'lucide-react';
import type { FunctionComponent } from 'react';

interface CurrentMarkProps {
  label: string,
}

/**
 * The mark a list puts on its currently active entry, so a card grid answers "where am I" the
 * same way the design system's selected paint alone is documented not to.
 *
 * It takes no pointer events: a card's whole surface is one control, reached through an overlay
 * that the header's action slot deliberately sits above, so anything inert dropped in that slot
 * punches a hole in the card's click target.
 */
export const CurrentMark: FunctionComponent<CurrentMarkProps> = ({ label }) => (
  <Check role="img" aria-label={label} className="pointer-events-none size-4 text-primary" />
);
