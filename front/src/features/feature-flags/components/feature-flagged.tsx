import type { FunctionComponent, ReactNode } from 'react';
import type { GatedFeatureFlag } from '@app/utils/feature-flags';
import { useFeatureFlag } from '../hooks/use-feature-flag';

interface FeatureFlaggedProps {
  flag: GatedFeatureFlag,
  children: ReactNode,
}

export const FeatureFlagged: FunctionComponent<FeatureFlaggedProps> = ({ flag, children }) => (useFeatureFlag(flag) ? <>{children}</> : null);
