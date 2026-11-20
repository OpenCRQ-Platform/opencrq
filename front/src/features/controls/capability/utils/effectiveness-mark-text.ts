import { t } from '@lingui/core/macro';
import { DERIVATION_WRITER } from '@app/module/client';
import type { CapabilityEvent } from '../types/capability';
import type { EffectivenessMark } from './effectiveness-lifeline-utils';
import { formatSignedPoints } from '../../../../components/shared/lifeline-utils';
import { formatDate, formatPointsAsPercent } from '../../../../utils';
import { capabilityEventSentence } from './capability-event-sentence';
import { eventSourceNamesByAxis, joinSourceNames } from './assessment-axes-utils';
import { formatConnectorName } from './connector-name';

export const formatEffectivenessPoints = (points: number): string => formatPointsAsPercent(points, 0);

export const previousLabel = (previous: string): string => t`from ${previous}`;

const derivedSourceNames = (event: CapabilityEvent): Array<string> => {
  const byAxis = eventSourceNamesByAxis(event.sources);
  const moved = byAxis.filter(({ axis }) => (axis === 'strength'
    ? event.oldStrength !== event.newStrength
    : event.oldCoverage !== event.newCoverage));
  return [...new Set((moved.length > 0 ? moved : byAxis).flatMap(({ names }) => names))];
};

export const effectivenessSourceLine = (event: CapabilityEvent): string => {
  if (event.connector === DERIVATION_WRITER) {
    const sourceNames = derivedSourceNames(event);
    if (sourceNames.length === 0) {
      return t`Derived`;
    }
    const names = joinSourceNames(sourceNames);
    return t`Derived from ${names}`;
  }
  if (event.connector !== null) {
    const names = formatConnectorName(event.connector);
    return t`Derived from ${names}`;
  }
  if (event.userId === null) {
    return t`Declared by a deleted user`;
  }
  if (event.userName === null) {
    return t`Declared`;
  }
  const author = event.userName;
  return t`Declared by ${author}`;
};

export const effectivenessInheritedLine = (event: CapabilityEvent, inScope: boolean): string | null =>
  (inScope && event.organizationId === null ? t`Inherited from the tenant` : null);

const markSummary = (mark: EffectivenessMark): string => {
  const date = formatDate(mark.at);
  if (mark.previous === null) {
    if (mark.value === null) {
      return t`${date}, not assessed.`;
    }
    const value = formatEffectivenessPoints(mark.value);
    return t`${date}, ${value}.`;
  }
  const previous = formatEffectivenessPoints(mark.previous);
  if (mark.value === null) {
    return t`${date}, not assessed, from ${previous}.`;
  }
  const value = formatEffectivenessPoints(mark.value);
  const change = formatSignedPoints(mark.value - mark.previous);
  return t`${date}, ${value}, ${change} from ${previous}.`;
};

/** What the live region reads for a mark, whole sentences only so each locale orders its own. */
export const effectivenessMarkAnnouncement = (mark: EffectivenessMark, inScope: boolean): string => {
  const summary = markSummary(mark);
  const sentence = capabilityEventSentence(mark.event);
  const source = effectivenessSourceLine(mark.event);
  return effectivenessInheritedLine(mark.event, inScope) === null
    ? t`${summary} ${sentence} ${source}.`
    : t`${summary} ${sentence} ${source}. Inherited from the tenant.`;
};
