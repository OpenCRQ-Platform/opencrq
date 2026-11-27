---
paths:
  - "front/src/**/*.test.ts"
  - "front/src/**/*.test.tsx"
---

<!-- Generated from .agents/instructions/writing-frontend-tests.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

Frontend test setups: pure utils, utils using the t macro, hooks, and component renders. The conventions below apply to the file being read.

# Writing frontend tests

Tests live alongside the code they test (`*.test.ts` / `*.test.tsx`). Run with `cd front && yarn test`.

### Pure util tests

No special setup needed. Import and test directly:

```ts
import { describe, expect, it } from 'vitest';
import { computePert, parseNum } from './scenario-loss-utils';

describe('computePert', () => {
  it('should compute PERT expected value', () => {
    expect(computePert(100, 200, 600)).toBe(250);
  });
});
```

### Pure utils with i18n (`t` macro)

When the function under test uses `t` from `@lingui/core/macro`, activate Lingui in `beforeAll`:

```ts
import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatExpiryLabel } from './expiry-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('formatExpiryLabel', () => {
  it('should format expired label', () => { /* ... */ });
});
```

### Hook tests

Require jsdom environment and `@testing-library/react`:

```ts
/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfirmationDialog } from './use-confirmation-dialog';

describe('useConfirmationDialog', () => {
  it('should start closed', () => {
    const { result } = renderHook(() => useConfirmationDialog());
    expect(result.current.isOpen).toBe(false);
  });
});
```

### Component render tests

Reserved for shared components carrying real logic (value mapping, guards), not for page layout.
Written as `.test.tsx`, they need three things:

- `/** @vitest-environment jsdom */` on the first line.
- `cleanup()` from `@testing-library/react` in `afterEach`, because several renders share the same document.
- `server.deps.inline: [/@filigran\/ui/]` in `front/vitest.config.ts`. Vitest externalises bare
  dependencies by default and hands them to Node, which cannot resolve the `.css` imports `@filigran/ui`
  ships. Inlining routes the package through Vite instead, which can. The flag is already set repo-wide,
  so a new component test only needs the first two points.

Test files share their worker's environment and module registry (`isolate: false`), so a `vi.mock`
or a React context set up in one file reaches the files run after it, and an import cycle entered
from another file's side can leave a module's exports `undefined` for every file after it. A test
that passes alone and fails in the full run, or the reverse, has that leak: remove it, or add the
file to `ISOLATED_TESTS` in `front/vitest.config.ts`, which gives it a fresh registry at a cost of a
few seconds of CI.

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberFormInput } from './number-form-input';

afterEach(() => {
  cleanup();
});

describe('NumberFormInput', () => {
  it('should call onChange with undefined when the field is cleared', () => {
    const onChange = vi.fn();
    render(<NumberFormInput aria-label="factor" value={42} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('factor'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
```

### Components that call tRPC

Render the real component under `renderWithTrpc` from `providers/trpc-test-harness.tsx`. It mounts the
tRPC providers on a fake client that answers by procedure path, and returns `calls`, what the client
was asked. Assert on the screen or on `calls`; `FAILED` answers with an error and `NEVER` leaves the
call pending. Never `vi.mock` the tRPC client or the `lib` barrel.

```tsx
const { calls } = renderWithTrpc(<TagRenameDrawer open onOpenChange={() => {}} tag={ROW} tags={TAGS} />, {
  answers: { 'supportingAssets.renameTag': FAILED },
});
fireEvent.click(screen.getByRole('button', { name: 'Save' }));
await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ path: 'supportingAssets.renameTag' })));
```
