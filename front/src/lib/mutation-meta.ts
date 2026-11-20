import type { MessageDescriptor } from '@lingui/core';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      skipSuccessToast?: boolean,
      skipErrorToast?: boolean,
      successMessage?: MessageDescriptor,
    },
    queryMeta: {
      // Opt-out for background/gate queries (e.g. the XTM One settings
      // gate) whose failure must never surface a user-facing error toast.
      skipErrorToast?: boolean,
    },
  }
}

export {};
