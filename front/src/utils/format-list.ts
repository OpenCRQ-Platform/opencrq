import { i18n } from '@lingui/core';

/** Items joined the way a sentence joins them in the application language: "a, b, and c", "a, b et c" in French. */
export const formatList = (items: ReadonlyArray<string>): string =>
  new Intl.ListFormat(i18n.locale || 'en', { type: 'conjunction' }).format(items);
