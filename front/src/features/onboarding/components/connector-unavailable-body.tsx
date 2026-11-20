import { Button, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Check, Copy } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useCopyToClipboard } from '../../../hooks';

interface ConnectorUnavailableBodyProps {
  message: string,
  /** The variables the platform administrator sets, one per line. */
  envBlock: string,
  documentationUrl: string,
}

export const ConnectorUnavailableBody: FunctionComponent<ConnectorUnavailableBodyProps> = ({ message, envBlock, documentationUrl }) => {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex flex-col gap-3">
      <Text as="p" variant="content-compact" className="text-default-secondary">{message}</Text>
      <div className="flex flex-col gap-2">
        <pre className="content-code overflow-x-auto rounded-sm border border-elevation-default bg-input-default p-3 select-all">{envBlock}</pre>
        <div className="flex items-center justify-between gap-4">
          <a
            href={documentationUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline-offset-4 hover:underline"
          >
            <Text as="span" variant="content-compact">{t`See the documentation`}</Text>
          </a>
          <Button
            type="button"
            priority="secondary"
            size="sm"
            startIcon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            onClick={() => {
              void copy(envBlock);
            }}
          >
            {copied ? t`Copied` : t`Copy`}
          </Button>
        </div>
      </div>
    </div>
  );
};
