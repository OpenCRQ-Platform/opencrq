import type { FunctionComponent, ReactNode } from 'react';
import { EmptyValue } from '../ui/empty-value';
import { ExpandableText } from '../ui/expandable-text';
import { EMPTY_VALUE } from '../../utils/empty-value';

interface BaseFieldProps {
  /** A rule-resolved value's label carries a `MetricInfo` explaining the rule; a plain string otherwise. */
  title: ReactNode,
  className?: string,
}

interface CardFieldProps extends BaseFieldProps {
  children: ReactNode,
}

export const CardField: FunctionComponent<CardFieldProps> = ({ title, children, className }) => (
  <div className={className}>
    <p className="text-muted-foreground txt-sub-content">{title}</p>
    <div className="mt-1">
      {children}
    </div>
  </div>
);

interface InfoFieldProps extends BaseFieldProps {
  value: string | null | undefined,
}

export const InfoField: FunctionComponent<InfoFieldProps> = ({ title, value, className }) => (
  <CardField title={title} className={className}>
    <p>{value ?? <EmptyValue />}</p>
  </CardField>
);

interface DescriptionFieldProps extends InfoFieldProps {
  lineClamp?: number,
}

export const DescriptionField: FunctionComponent<DescriptionFieldProps> = ({ title, value, className, lineClamp }) => (
  <CardField title={title} className={className}>
    <ExpandableText lineClamp={lineClamp} text={value ?? EMPTY_VALUE} />
  </CardField>
);
