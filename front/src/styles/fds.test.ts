import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fdsCss = readFileSync(join(import.meta.dirname, 'fds.css'), 'utf-8');

describe('generated fds.css', () => {
  // A data-coloured Chip sets --chip-data-ink-dark / --chip-data-ink-light inline on the element.
  // `yarn fds:css` must keep those references unprefixed, or label chips lose their edge and ink.
  it.each(['dark', 'light'])('reads the runtime chip ink variable unprefixed (%s)', (scheme) => {
    expect(fdsCss).toContain(`var(--chip-data-ink-${scheme})`);
    expect(fdsCss).not.toContain(`var(--fds-chip-data-ink-${scheme})`);
  });
});
