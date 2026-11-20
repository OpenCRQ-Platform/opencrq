import {  clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Extend tailwind-merge so txt-* typography classes (from @filigran/ui)
// are recognized as font-size utilities and override text-sm, text-base, etc.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          txt: [
            'jumbo', 'title', 'subtitle', 'subtitle2', 'category',
            'tab', 'container-title', 'default', 'sub-content', 'table',
            'mini', 'body2', 'h3', 'h4', 'h5',
          ],
        },
      ],
    },
  },
});

export const cn = (...inputs: Array<ClassValue>) => twMerge(clsx(inputs));
