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
  it('should say no vector will come once an NVD pass found no usable record', () => {
    render(<UnscoredMark nvdRecordMissing />);

    expect(screen.getByText('No vector')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Why no usable NVD record' })).toBeTruthy();
    expect(screen.queryByText('Pending vector')).toBeNull();
  });

  it('should say the vector is pending otherwise', () => {
    render(<UnscoredMark nvdRecordMissing={false} />);

    expect(screen.getByText('Pending vector')).toBeTruthy();
    expect(screen.queryByText('No vector')).toBeNull();
  });
});
