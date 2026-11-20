import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@app/module';

const mockRederiveAssessments = vi.fn().mockResolvedValue({ written: 0, cleared: 0, crossings: [] });
const mockMeasureTechniqueTestResults = vi.fn().mockResolvedValue({ written: 0, deleted: 0, crossings: [] });
const mockEnqueueJob = vi.fn().mockResolvedValue({ jobId: 'job-booking-1', alreadyExisted: false });
const mockWithOrigin = vi.fn().mockReturnValue({
  controlCapabilities: { rederiveAssessments: mockRederiveAssessments },
  controlValidation: { measureTechniqueTestResults: mockMeasureTechniqueTestResults },
  jobs: { enqueueJob: mockEnqueueJob },
});
const mockCreateServices = vi.fn().mockReturnValue({ withOrigin: mockWithOrigin });
const sharedDb = { shared: true };

vi.mock('@app/module', () => ({
  allServiceDefinitions: [],
  createServices: mockCreateServices,
}));

vi.mock('../../engines/db', () => ({ dbEngine: { db: sharedDb } }));

vi.mock('../crq-indicators/crq-levers-booking-handler', () => ({ CRQ_LEVERS_BOOKING_JOB: 'crq-levers-booking' }));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn() }),
}));

const { capabilityDerivationHandler } = await import('./capability-derivation-handler');

const makeCtx = (overrides: Partial<JobContext> = {}): JobContext => ({
  jobId: 'job-derivation-1',
  tenantId: 'tenant-abc',
  kind: 'capability-derivation',
  interactive: true,
  payload: {},
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: vi.fn().mockResolvedValue(undefined),
  saveStateSnapshot: vi.fn().mockResolvedValue(undefined),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the services factory is mocked, so the run's instance is only passed through
  runDb: {} as never,
  ...overrides,
});

describe('capabilityDerivationHandler', () => {
  beforeEach(() => {
    mockRederiveAssessments.mockClear();
    mockMeasureTechniqueTestResults.mockClear();
    mockWithOrigin.mockClear();
    mockCreateServices.mockClear();
    mockEnqueueJob.mockClear();
  });

  it('refuses to run unobserved', async () => {
    await expect(capabilityDerivationHandler(makeCtx({ runDb: undefined }))).rejects.toThrow('capability derivation must run as an observed job');
    expect(mockRederiveAssessments).not.toHaveBeenCalled();
  });

  it('runs under the job of the tenant it was booked for', async () => {
    await capabilityDerivationHandler(makeCtx());

    expect(mockWithOrigin).toHaveBeenCalledWith({ type: 'job', tenantId: 'tenant-abc', jobKind: 'capability-derivation', interactive: true });
  });

  it('rederives the tenant once per run', async () => {
    await capabilityDerivationHandler(makeCtx());

    expect(mockRederiveAssessments).toHaveBeenCalledOnce();
  });

  it('hands the controls it moved to a booking run, through the shared instance', async () => {
    const crossings = [{ capabilityId: 'control-1', axes: ['strength'] }];
    mockRederiveAssessments.mockResolvedValueOnce({ written: 1, cleared: 0, crossings });

    await capabilityDerivationHandler(makeCtx());

    expect(mockCreateServices).toHaveBeenLastCalledWith([], sharedDb);
    expect(mockEnqueueJob).toHaveBeenCalledWith({
      kind: 'crq-levers-booking',
      tenantId: 'tenant-abc',
      payload: { crossings },
      triggeredBy: 'event',
      interactive: true,
    });
  });

  it('measures the test results after the posture, knowing which axes of which controls the posture moved', async () => {
    const crossings = [{ capabilityId: 'control-1', axes: ['strength'] }];
    mockRederiveAssessments.mockResolvedValueOnce({ written: 1, cleared: 0, crossings });

    await capabilityDerivationHandler(makeCtx());

    expect(mockMeasureTechniqueTestResults).toHaveBeenCalledWith({ now: expect.any(Date), crossings });
  });

  it('hands the controls whose test results moved in a scope to the booking run, with the posture moves', async () => {
    const posture = { capabilityId: 'control-1', axes: ['strength'] };
    const tested = { capabilityId: 'control-2', axes: [], organizationIds: ['scope-1'] };
    mockRederiveAssessments.mockResolvedValueOnce({ written: 1, cleared: 0, crossings: [posture] });
    mockMeasureTechniqueTestResults.mockResolvedValueOnce({ written: 1, deleted: 0, crossings: [tested] });

    await capabilityDerivationHandler(makeCtx());

    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { crossings: [posture, tested] } }));
  });

  it('books the posture moves before failing when the measurement fails', async () => {
    const crossings = [{ capabilityId: 'control-1', axes: ['strength'] }];
    mockRederiveAssessments.mockResolvedValueOnce({ written: 1, cleared: 0, crossings });
    mockMeasureTechniqueTestResults.mockRejectedValueOnce(new Error('measurement failed'));

    await expect(capabilityDerivationHandler(makeCtx())).rejects.toThrow('measurement failed');

    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { crossings } }));
  });

  it('books nothing when it moved no control', async () => {
    await capabilityDerivationHandler(makeCtx());

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});
