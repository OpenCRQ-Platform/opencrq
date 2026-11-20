import { Check } from 'lucide-react';
import type { FunctionComponent } from 'react';

const getInitials = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) {
    return '?';
  }
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
};

interface WizardSelectionCardProps {
  name: string,
  description?: string | null,
  selected: boolean,
  onClick: () => void,
  disabled?: boolean,
}

export const WizardSelectionCard: FunctionComponent<WizardSelectionCardProps> = ({
  name,
  description,
  selected,
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all duration-150 ${
      selected
        ? 'border-primary bg-primary/5 ring-1 ring-primary'
        : 'hover:border-primary/50 hover:shadow-sm'
    } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
  >
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md txt-body2 font-semibold ${
        selected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      {getInitials(name)}
    </div>
    <div className="min-w-0 flex-1">
      <p className="txt-body2 font-medium leading-tight">{name}</p>
      {description && (
        <p className="mt-0.5 line-clamp-2 txt-sub-content text-muted-foreground">{description}</p>
      )}
    </div>
    {selected && (
      <Check className="h-4 w-4 shrink-0 text-primary" />
    )}
  </button>
);

interface WizardSelectionGridProps<T extends { id: string, name: string, description?: string | null }> {
  items: Array<T>,
  selectedId: string | null,
  onSelect: (id: string) => void,
  disabled?: boolean,
}

export const WizardSelectionGrid = <T extends { id: string, name: string, description?: string | null }>({
  items,
  selectedId,
  onSelect,
  disabled,
}: WizardSelectionGridProps<T>) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {items.map((item) => (
      <WizardSelectionCard
        key={item.id}
        name={item.name}
        description={item.description}
        selected={item.id === selectedId}
        onClick={() => onSelect(item.id)}
        disabled={disabled}
      />
    ))}
  </div>
);

interface WizardMultiSelectionGridProps<T extends { id: string, name: string, description?: string | null }> {
  items: Array<T>,
  selectedIds: Array<string>,
  onToggle: (id: string) => void,
  disabled?: boolean,
}

export const WizardMultiSelectionGrid = <T extends { id: string, name: string, description?: string | null }>({
  items,
  selectedIds,
  onToggle,
  disabled,
}: WizardMultiSelectionGridProps<T>) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {items.map((item) => (
      <WizardSelectionCard
        key={item.id}
        name={item.name}
        description={item.description}
        selected={selectedIds.includes(item.id)}
        onClick={() => onToggle(item.id)}
        disabled={disabled}
      />
    ))}
  </div>
);
