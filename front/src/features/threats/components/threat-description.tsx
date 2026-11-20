import type { FunctionComponent } from 'react';
import type { ThreatSourceKind } from './threat-origin';
import { ExpandableText } from '../../../components/ui/expandable-text';
import { MitreDescription } from '../../mitre-attack/components/mitre-description';

const DESCRIPTION_LINES = 5;

/** The Default Threats dataset keeps MITRE's markdown and its citations, laid out as attack.mitre.org does; any other source's text stays plain. */
export const ThreatDescription: FunctionComponent<{ description: string, kind: ThreatSourceKind }> = ({ description, kind }) => (
  kind === 'default-threats'
    ? <MitreDescription text={description} />
    : <ExpandableText text={description} lineClamp={DESCRIPTION_LINES} />
);
