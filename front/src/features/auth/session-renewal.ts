// Set when a renewal did not go through while the session still runs: no renewal until the page
// reloads, which the session's end brings, so a failing XTM One is not asked again on every page.
let renewalDeferred = false;

export const deferRenewal = (): void => {
  renewalDeferred = true;
};

export const isRenewalDeferred = (): boolean => renewalDeferred;
