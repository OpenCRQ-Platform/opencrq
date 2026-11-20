import { describe, expect, it } from 'vitest';
import { dashboardPageListSearchSchema } from './dashboard-page-list-search';

describe('dashboardPageListSearchSchema', () => {
  it('opens on 90 days when the address names no window', () => {
    expect(dashboardPageListSearchSchema.parse({})).toEqual({ riskScope: 'all', window: 90 });
  });

  it('keeps a 30 day window', () => {
    expect(dashboardPageListSearchSchema.parse({ window: 30 })).toEqual({ riskScope: 'all', window: 30 });
  });

  it('opens on 90 days for a window the endpoint refuses', () => {
    expect(dashboardPageListSearchSchema.parse({ window: 60 })).toEqual({ riskScope: 'all', window: 90 });
  });
});
