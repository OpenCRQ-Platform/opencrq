import type { CapabilityFunction } from '@app/module/client';
import type { ValidationCell, ValidationSummary } from '../types/validation';
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../../lib';

export const validationCellKey = (techniqueId: string, fn: CapabilityFunction): string =>
  `${techniqueId}:${fn}`;

export interface CapabilityValidation {
  /**
   * Whether validation exists for this control at all: the tenant has a simulation connector and
   * the control is within simulation reach. `undefined` while the connector status is unknown, but
   * an out-of-reach control reads `false` immediately, since its reachability is known
   * synchronously.
   *
   * This is what decides that a surface exists: the Validation tab, and the route behind it. It must
   * not wait on the derivation, or a tab would appear a second after the page it belongs to.
   */
  isAvailable: boolean | undefined,
  /**
   * Whether a measurement may be stated. A tenant with no simulation connector must get the control
   * page exactly as it was before this feature, so the gate lives here alone and every surface reads
   * it rather than inventing its own emptiness test.
   *
   * It stays closed until the read has actually succeeded. An empty derivation and a derivation that
   * has not arrived are indistinguishable in the payload, and rendering the second as the first
   * states a coverage of zero on a control nobody has looked at yet, which is the one thing these
   * surfaces exist to stop saying. A failed read leaves the page as it was before the feature.
   */
  isVisible: boolean,
  summary: ValidationSummary | null,
  /** Keyed by {@link validationCellKey}; a missing key is a technique nothing has tested. */
  cellByTechnique: Map<string, ValidationCell>,
  /** Base URL of the tenant's OpenAEV, for the evidence deep links; null when none is configured. */
  openaevUrl: string | null,
}

interface OpenaevConnector {
  /** `undefined` while the connector status is unknown. */
  isConfigured: boolean | undefined,
  url: string | null,
}

/** Whether the tenant has a usable OpenAEV connector, which every validation surface needs. */
export const useOpenaevConnector = (): OpenaevConnector => {
  const trpc = useTRPC();
  const { data: connectorsStatus, isSuccess: isStatusKnown } =
    useQuery(trpc.integrations.getConnectorsStatus.queryOptions());
  // A tenant integration row can outlive the platform-level connector, so both flags gate here.
  return {
    isConfigured: isStatusKnown
      ? connectorsStatus?.openaev.platformConfigured === true && connectorsStatus.openaev.tenantConfigured === true
      : undefined,
    url: connectorsStatus?.openaev.url ?? null,
  };
};

/**
 * What the simulations proved about one control.
 *
 * `isReachable` is the control's `isSimulationReachable` verdict: a control no security platform
 * family implements can never receive a result, so every validation surface stays absent for it
 * rather than stating an untestable gap as `Never tested`.
 *
 * One query serves the Overview and both function tabs: TanStack Query caches it across
 * the tabs of a control, so the page issues a single validation read however many surfaces consume
 * it. Inside a scope it measures that scope's own assets.
 */
export const useCapabilityValidation = (capabilityId: string, isReachable: boolean): CapabilityValidation => {
  const trpc = useTRPC();
  const { isConfigured, url: openaevUrl } = useOpenaevConnector();
  const isAvailable = isReachable ? isConfigured : false;
  const { organizationId } = useParams({ strict: false });
  const { data, isSuccess } = useQuery(trpc.controlValidation.getControlValidation.queryOptions(
    { capabilityId, organizationId },
    { enabled: isAvailable === true },
  ));

  return {
    isAvailable,
    isVisible: isAvailable === true && isSuccess,
    summary: data?.summary ?? null,
    cellByTechnique: new Map(
      (data?.cells ?? []).map((cell) => [validationCellKey(cell.techniqueId, cell.function), cell]),
    ),
    openaevUrl,
  };
};
