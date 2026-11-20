/**
 * Height in px of the design-system `Header`, for the few consumers that need
 * it as a number rather than through CSS. The design system publishes it as
 * the `--fds-header-height` custom property with the value only in the `var()`
 * fallback, so it is unreadable from JS: this constant must be kept in step
 * with the design system on every version bump.
 */
export const FDS_HEADER_HEIGHT = 68;
