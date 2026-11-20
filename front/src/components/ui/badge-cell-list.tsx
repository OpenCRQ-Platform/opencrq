import { Chip } from '@filigran/design-system';
import { EmptyValue } from './empty-value';

const MAX = 2;

interface BadgeCellListProps {
  items: ReadonlyArray<{ id: string, name: string }> | undefined,
}

export const BadgeCellList = ({ items }: BadgeCellListProps) => {
  if (!items || items.length === 0) {
    return <EmptyValue />;
  }
  return (
    // One line per row (Design standards s.3): chips never wrap, a long name shrinks and is cut.
    <div className="flex min-w-0 flex-nowrap gap-1 overflow-hidden">
      {items.slice(0, MAX).map((item) => (
        <Chip key={item.id} label={item.name} className="min-w-0 shrink" />
      ))}
      {items.length > MAX && <Chip label={`+${items.length - MAX}`} className="shrink-0" />}
    </div>
  );
};
