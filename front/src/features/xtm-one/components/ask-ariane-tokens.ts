/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import type { CSSProperties } from 'react';

/*
 * The design system semantic tokens the chatbot panel reads by their plain
 * names (`--border-elevation-subtle`, `--bg-elevation-disabled`, ...), with a
 * fallback of its own when the host does not set them. OpenCTI and OpenAEV load
 * the design system stylesheet unprefixed, so the panel paints with their
 * tokens: the composer's light grey edge, the send button's filled and disabled
 * looks. This app namespaces the same tokens with `--fds-` (see
 * scripts/generate-fds-css.ts), which left every one of them unset on the
 * panel: the composer border fell back to `currentColor`, white in dark mode.
 * The portal restates each under its plain name, reading this app's value.
 */
const DESIGN_SYSTEM_TOKENS = [
  'bg-elevation-default',
  'bg-elevation-disabled',
  'bg-elevation-highlight',
  'bg-input-default',
  'bg-input-hover',
  'border-elevation-default',
  'border-elevation-subtle',
  'border-input-hover',
  'icon-disabled',
  'icon-error',
  'icon-info',
  'icon-warning',
  'text-default-disabled',
  'text-default-primary',
  'text-default-secondary',
  'text-input-disabled',
  'text-input-error',
  'text-input-helper',
  'text-input-label',
  'text-input-placeholder',
  'text-input-required',
  'text-input-value',
  'text-negative-primary',
  'text-content-base',
  'text-content-button',
  'text-content-caption',
  'text-content-compact',
  'font-content-base',
  'font-content-button',
  'font-content-caption',
  'font-content-compact',
  'font-weight-content-compact',
  'leading-content-base',
  'leading-content-button',
  'leading-content-caption',
  'leading-content-compact',
  'tracking-content-base',
  'tracking-content-button',
  'tracking-content-caption',
  'tracking-content-compact',
  'text-title-sm',
  'text-title-md',
  'text-title-jumbo',
  'radius-sm',
  'radius-lg',
  'shadow-global-shadow',
  'width-overlay-md',
] as const;

/** Each design system token the panel reads, under its plain name, pointing at this app's `--fds-` value. */
export const designSystemTokens = (): CSSProperties => {
  const tokens: Record<string, string> = Object.fromEntries(
    DESIGN_SYSTEM_TOKENS.map((name) => [`--${name}`, `var(--fds-${name})`]),
  );
  return tokens;
};
