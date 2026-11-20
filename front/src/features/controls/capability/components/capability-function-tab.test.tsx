/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityDetail } from '../types/capability';

vi.mock('../hooks/use-function-postures', () => ({
  useFunctionPostures: () => ({ postureOf: () => undefined, notDeployedOnScope: false }),
}));

vi.mock('./capability-function-section', () => ({
  CapabilityFunctionSection: ({ capabilityFunction, action }: { capabilityFunction: string, action?: unknown }) => (
    <div data-testid="section">{`${capabilityFunction} section${action === undefined ? '' : ' with action'}`}</div>
  ),
}));

vi.mock('./capability-techniques-matrix', () => ({
  CapabilityTechniquesMatrix: () => <div data-testid="matrix">matrix</div>,
}));

const { CapabilityFunctionTab } = await import('./capability-function-tab');

afterEach(cleanup);

const CAPABILITY: CapabilityDetail = {
  id: 'c1',
  externalId: 'IDP',
  name: 'Identity and Access Management',
  description: '',
  domain: 'identities',
  position: 19,
  assessment: null,
  lastAssessedAt: null,
  lastAssessedBy: null,
  lastAssessedConnector: null,
  lastDerivedAt: null,
  lastDerivedBy: null,
  assessmentSources: [],
  rungs: [],
  edges: [],
  crosswalk: [],
  securityPlatformFamilies: [],
  protectedFamilies: [],
};

describe('CapabilityFunctionTab', () => {
  it('should open on the function section without its open action, then the matrix', () => {
    render(<CapabilityFunctionTab capability={CAPABILITY} capabilityFunction="detect" />);

    const section = screen.getByTestId('section');
    const matrix = screen.getByTestId('matrix');
    expect(section.textContent).toBe('detect section');
    expect(section.compareDocumentPosition(matrix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
