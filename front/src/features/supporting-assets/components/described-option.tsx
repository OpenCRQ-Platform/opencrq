import type { FunctionComponent } from 'react';

interface DescribedOptionProps {
  label: string,
  description: string,
}

/** An option row of a category or subcategory picker: the label, then its meaning, wrapped in full (never clipped). */
export const DescribedOption: FunctionComponent<DescribedOptionProps> = ({ label, description }) => (
  <span className="flex min-w-0 flex-col py-1">
    <span>{label}</span>
    {description !== '' && <span className="txt-sub-content whitespace-normal break-words text-muted-foreground">{description}</span>}
  </span>
);
