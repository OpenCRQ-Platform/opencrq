import { useEffect, useRef, useState } from 'react';

const DEFAULT_RESET_DELAY = 2000;

export const useCopyToClipboard = (resetDelay = DEFAULT_RESET_DELAY) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), resetDelay);
    } catch {
      // Clipboard API may fail in insecure contexts or when permissions are denied
    }
  };

  return { copied, copy } as const;
};
