/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UnscoredMark } from './pending-vector';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('UnscoredMark', () => {
  it('should say NVD holds no usable record once a pass found none', () => {
    render(<UnscoredMark nvdRecordMissing />);

    expect(screen.getByText('No usable NVD record')).toBeTruthy();
    expect(screen.queryByText('Pending vector')).toBeNull();
  });

  it('should say the vector is pending otherwise', () => {
    render(<UnscoredMark nvdRecordMissing={false} />);

    expect(screen.getByText('Pending vector')).toBeTruthy();
    expect(screen.queryByText('No usable NVD record')).toBeNull();
  });
});
