import { Button } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useParams } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import type { ChangeEvent, FunctionComponent } from 'react';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useJobStatus } from '../../../hooks';
import { useTRPC } from '../../../lib';

const TERMINAL_STATUSES = ['succeeded', 'partial', 'dlq', 'cancelled'];

const uploadJobResponseSchema = z.object({ jobId: z.string() });

const requestUploadJob = async (file: File, tenantId: string): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/threats/upload', {
    method: 'POST',
    body: formData,
    credentials: 'include',
    headers: { 'x-tenant-id': tenantId },
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }

  const { jobId } = uploadJobResponseSchema.parse(await response.json());
  return jobId;
};

/**
 * Uploads a STIX bundle to `/api/threats/upload` (plain fetch, not tRPC — the backend
 * route streams the multipart body straight to RustFS). Progress is then tracked through the
 * generic `jobs` system, same pattern as the "Sync all" button on the supporting assets page.
 */
export const ThreatUploadButton: FunctionComponent = () => {
  const trpc = useTRPC();
  const { toast } = useToast();
  const { tenantId } = useParams({ strict: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: lastJob } = useQuery(trpc.jobs.getLastJob.queryOptions(
    { kind: 'threat-bundle-analysis' },
  ));
  const { data: fileStorageSettings, isLoading: isFileStorageSettingsLoading } = useQuery(trpc.fileStorage.getSettings.queryOptions());
  const fileStorageConfirmedDisabled = fileStorageSettings?.enabled === false;
  const fileStorageDisabled = isFileStorageSettingsLoading || fileStorageConfirmedDisabled;

  const effectiveJobId = activeJobId ?? (lastJob && !TERMINAL_STATUSES.includes(lastJob.status) ? lastJob.id : null);

  const { isActive } = useJobStatus({
    jobId: effectiveJobId,
    onSuccess: () => {
      setActiveJobId(null);
      toast({ description: t`Bundle analyzed successfully.` });
    },
    onFailed: () => {
      setActiveJobId(null);
      toast({ description: t`Bundle analysis failed. Please check the file and try again.`, variant: 'destructive' });
    },
  });

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    if (!tenantId) {
      return;
    }

    setIsUploading(true);
    const jobId = await requestUploadJob(file, tenantId).catch(() => null);
    setIsUploading(false);

    if (jobId === null) {
      toast({ description: t`Upload failed. Please try again.`, variant: 'destructive' });
      return;
    }

    setActiveJobId(jobId);
  };

  const isBusy = isUploading || isActive;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void handleFileSelected(event)}
      />
      <span title={fileStorageConfirmedDisabled ? t`File storage is not configured` : undefined}>
        <Button
          priority="secondary"
          startIcon={<Upload className="size-4" />}
          loading={isBusy}
          disabled={fileStorageDisabled}
          onClick={() => inputRef.current?.click()}
        >
          {isBusy ? <Trans>Analyzing…</Trans> : <Trans>Analyze new bundle</Trans>}
        </Button>
      </span>
    </>
  );
};
