import type { LucideIcon } from 'lucide-react';
import {
  AppWindow,
  Box,
  Brain,
  Building2,
  Cloud,
  Cpu,
  GitBranch,
  Globe,
  Network,
  Server,
  Shapes,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { CategoryGlyph, DependencyGraphNode } from '../dependency-graph-utils';
import { assetDomain, assetDomainColor, categoryGlyph } from '../dependency-graph-utils';
import { TINT_ALPHA } from '../../../components/shared/column-graph-paint';
import { useTheme } from '../../../providers/theme-provider';
import { cn } from '../../../utils';

const GLYPH_ICON: Record<CategoryGlyph, LucideIcon> = {
  'server': Server,
  'box': Box,
  'cloud': Cloud,
  'globe': Globe,
  'network': Network,
  'smartphone': Smartphone,
  'cpu': Cpu,
  'user': User,
  'app-window': AppWindow,
  'brain': Brain,
  'git-branch': GitBranch,
  'shield-check': ShieldCheck,
  'shapes': Shapes,
};

const ACCENT = 'var(--fds-color-filigran-brand-primary)';
const MUTED = 'var(--fds-text-default-secondary)';

export const DependencyGraphNodeBadge: FunctionComponent<{ node: DependencyGraphNode, size: 'md' | 'sm' }> = ({ node, size }) => {
  const { effectiveTheme } = useTheme();
  const tintPercent = TINT_ALPHA[effectiveTheme] * 100;
  const { asset } = node;
  const primary = node.kind === 'primary';
  const ring = primary ? ACCENT : assetDomainColor(asset === null ? 'to_classify' : assetDomain(asset.categoryId));
  const Glyph = primary ? Building2 : asset === null ? Globe : GLYPH_ICON[categoryGlyph(asset.categoryId)];
  const inventoried = primary || asset !== null;

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center border-2',
        size === 'md' ? 'size-8' : 'size-[26px]',
        primary ? 'rounded-[7px]' : 'rounded-full',
      )}
      style={inventoried
        ? { borderColor: ring, backgroundColor: `color-mix(in srgb, ${ring} ${tintPercent}%, transparent)` }
        : { borderColor: MUTED, borderStyle: 'dashed' }}
    >
      <Glyph className={size === 'md' ? 'size-4' : 'size-3.5'} style={{ color: inventoried ? ring : MUTED }} />
    </span>
  );
};
