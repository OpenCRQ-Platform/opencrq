import { Button, Chip, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, IconButton, Input } from '@filigran/design-system';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@filigran/ui';
import { SERVICE_ACCOUNT_TOKEN_PREFIX } from '@app/utils/service-account-token';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, EllipsisVertical, Plus } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  DrawerForm,
  DrawerFormActions,
  FormDrawer,
} from '../../../components';
import { SectionCard } from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useConfirmationDialog, useCopyToClipboard } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { arrayOfAll, formatDate } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';

const TokenRevealDialog: FunctionComponent<{
  open: boolean,
  token: string,
  onClose: () => void,
}> = ({ open, token, onClose }) => {
  const { copied, copy } = useCopyToClipboard();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
        }
      }}
    >
      {/* The token is shown once, so a stray click outside must not be what dismisses it. */}
      <DialogContent onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogTitle><Trans>Your new API token</Trans></DialogTitle>
        <DialogDescription>
          <Trans>
            Copy this token now — it will not be shown again. Store it securely.
          </Trans>
        </DialogDescription>

        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
          <code className="txt-body2 flex-1 break-all font-mono">{token}</code>
          <IconButton
            priority="tertiary"
            size="sm"
            className="shrink-0"
            aria-label={t`Copy token`}
            icon={copied
              ? <Check className="h-3.5 w-3.5 text-green-600" />
              : <Copy className="h-3.5 w-3.5" />}
            onClick={() => void copy(token)}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button priority="secondary" onClick={onClose}><Trans>Close</Trans></Button>
          </DialogClose>
          <Button onClick={() => {
            void copy(token);
            onClose();
          }}>
            <Trans>Copy &amp; close</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const EXPIRY_OPTIONS = [
  { value: '1d', label: () => t`1 day` },
  { value: '7d', label: () => t`7 days` },
  { value: '30d', label: () => t`30 days` },
  { value: '90d', label: () => t`90 days` },
  { value: '365d', label: () => t`1 year` },
  { value: 'none', label: () => t`No expiry` },
] as const;

type ExpiryOption = (typeof EXPIRY_OPTIONS)[number]['value'];

const expiryToDate = (option: ExpiryOption): Date | null => {
  if (option === 'none') {
    return null;
  }
  const days: Record<Exclude<ExpiryOption, 'none'>, number> = {
    '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365,
  };
  const d = new Date();
  d.setDate(d.getDate() + days[option]);
  return d;
};

const generateFormSchema = z.object({
  name: z.string().min(1),
  expiry: z.enum(arrayOfAll<ExpiryOption>()(['1d', '7d', '30d', '90d', '365d', 'none'])),
});

const GenerateTokenForm: FunctionComponent<{
  form: ReturnType<typeof useForm<z.infer<typeof generateFormSchema>>>,
  onSubmit: (values: z.infer<typeof generateFormSchema>) => void,
  isPending: boolean,
}> = ({ form, onSubmit, isPending }) => (
  <DrawerForm
    form={form}
    onSubmit={onSubmit}
    footer={(
      <DrawerFormActions
        isPending={isPending}
        submitLabel={t`Generate`}
        pendingLabel={t`Generating...`}
      />
    )}
  >
    <Controller
      control={form.control}
      name="name"
      render={({ field, fieldState }) => (
        <Input
          {...field}
          label={t`Token name`}
          required
          placeholder={t`e.g. CI/CD pipeline`}
          error={fieldState.error?.message}
        />
      )}
    />
    <Controller
      control={form.control}
      name="expiry"
      render={({ field, fieldState }) => (
        <div>
          <Select value={field.value} onValueChange={field.onChange} error={fieldState.invalid}>
            <SelectLabel required>{t`Expiry`}</SelectLabel>
            <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label()}
                </SelectItem>
              ))}
            </SelectContent>
            {fieldState.error?.message && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
          </Select>
        </div>
      )}
    />
  </DrawerForm>
);

type TokenStatus = 'active' | 'revoked' | 'expired';

const getTokenStatus = (revokedAt: string | null, expiresAt: string | null): TokenStatus => {
  if (revokedAt) {
    return 'revoked';
  }
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return 'expired';
  }
  return 'active';
};

const TokenStatusBadge: FunctionComponent<{ status: TokenStatus }> = ({ status }) => {
  if (status === 'active') {
    return <Chip severity="low" label={t`Active`} />;
  }
  if (status === 'revoked') {
    return <Chip label={t`Revoked`} />;
  }
  return <Chip severity="critical" label={t`Expired`} />;
};

const formatTokenDate = (date: string | null): string => {
  if (!date) {
    return EMPTY_VALUE;
  }
  return formatDate(date);
};

interface TokenItem {
  id: string,
  name: string,
  tokenId: string,
  lastUsedAt: string | null,
  expiresAt: string | null,
  revokedAt: string | null,
  createdAt: string | null,
}

const TokenRow: FunctionComponent<{
  token: TokenItem,
  onRotate: (tokenId: string) => void,
  onRevoke: (tokenId: string) => void,
  isRotating: boolean,
}> = ({ token, onRotate, onRevoke, isRotating }) => {
  const status = getTokenStatus(token.revokedAt, token.expiresAt);
  const isActive = status === 'active';

  return (
    <TableRow>
      <TableCell>
        <span className="txt-body2 font-medium block truncate">{token.name}</span>
        <span className="txt-sub-content text-muted-foreground font-mono">
          {SERVICE_ACCOUNT_TOKEN_PREFIX}{token.tokenId}…
        </span>
      </TableCell>
      <TableCell>
        <TokenStatusBadge status={status} />
      </TableCell>
      <TableCell className="txt-body2">{formatTokenDate(token.lastUsedAt)}</TableCell>
      <TableCell className="txt-body2">
        {token.expiresAt ? formatTokenDate(token.expiresAt) : t`Never`}
      </TableCell>
      <TableCell className="txt-body2">{formatTokenDate(token.createdAt)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <IconActions disabled={!isActive} icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
          {isActive && (
            <IconActionsItem
              onClick={() => onRotate(token.id)}
              disabled={isRotating}
            >
              <Trans>Rotate</Trans>
            </IconActionsItem>
          )}
          {isActive && (
            <IconActionsItem
              className="text-feedback-error-primary"
              onClick={() => onRevoke(token.id)}
            >
              <Trans>Revoke</Trans>
            </IconActionsItem>
          )}
        </IconActions>
      </TableCell>
    </TableRow>
  );
};

export const ServiceAccountTokens: FunctionComponent<{ serviceAccountId: string }> = ({ serviceAccountId }) => {
  const trpc = useTRPC();
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [generateDrawerOpen, setGenerateDrawerOpen] = useState(false);
  const revokeDialog = useConfirmationDialog();
  const { confirm: confirmRevoke, requestConfirmation: requestRevoke } = revokeDialog;

  const generateForm = useForm<z.infer<typeof generateFormSchema>>({
    resolver: zodResolver(generateFormSchema),
    defaultValues: { name: '', expiry: '90d' },
  });

  const { data: tokens, isLoading } = useQuery(trpc.serviceAccounts.listTokens.queryOptions({ serviceAccountId }));

  const generateToken = useMutation(trpc.serviceAccounts.generateToken.mutationOptions({
    meta: { skipSuccessToast: true },
    onSuccess: (data) => {
      generateForm.reset();
      setRevealToken(data.plainToken);
      setGenerateDrawerOpen(false);
    },
  }));

  const rotateToken = useMutation(trpc.serviceAccounts.rotateToken.mutationOptions({
    meta: { skipSuccessToast: true },
    onSuccess: (data) => {
      setRevealToken(data.plainToken);
    },
  }));

  const revokeToken = useMutation(trpc.serviceAccounts.revokeToken.mutationOptions({
    meta: { successMessage: msg`Token revoked successfully.` },
  }));

  const handleGenerateSubmit = (values: { name: string, expiry: ExpiryOption }) => {
    generateToken.mutate({
      serviceAccountId,
      name: values.name,
      expiresAt: expiryToDate(values.expiry)?.toISOString() ?? null,
    });
  };

  const handleRevokeConfirm = () => {
    const id = confirmRevoke();
    if (id) {
      revokeToken.mutate({ tokenId: id });
    }
  };

  return (
    <>
      {revealToken !== null && (
        <TokenRevealDialog
          open
          token={revealToken}
          onClose={() => setRevealToken(null)}
        />
      )}

      <DeleteConfirmDialog
        open={revokeDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            revokeDialog.cancel();
          }
        }}
        onConfirm={handleRevokeConfirm}
        title={<Trans>Revoke token</Trans>}
        description={<Trans>This will permanently revoke this token. Any integrations using it will lose access immediately.</Trans>}
        submitButtonText={<Trans>Revoke</Trans>}
      />

      <SectionCard
        title={t`API Tokens`}
        headerAction={
          <FormDrawer
            title={t`Generate API token`}
            open={generateDrawerOpen}
            onClose={() => setGenerateDrawerOpen(false)}
            trigger={
              <Button priority="secondary" size="sm" startIcon={<Plus className="h-4 w-4" />} onClick={() => setGenerateDrawerOpen(true)}>
                <Trans>Generate token</Trans>
              </Button>
            }
          >
            <GenerateTokenForm
              form={generateForm}
              onSubmit={handleGenerateSubmit}
              isPending={generateToken.isPending}
            />
          </FormDrawer>
        }
      >
        {isLoading && (
          <p className="txt-body2 text-muted-foreground">{t`Loading tokens…`}</p>
        )}
        {!isLoading && (!tokens || tokens.length === 0) && (
          <p className="txt-body2 text-muted-foreground">
            <Trans>No tokens yet. Generate one to allow API access for this service account.</Trans>
          </p>
        )}
        {tokens && tokens.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><span className="txt-container-title"><Trans>Name</Trans></span></TableHead>
                <TableHead><span className="txt-container-title"><Trans>Status</Trans></span></TableHead>
                <TableHead><span className="txt-container-title"><Trans>Last used</Trans></span></TableHead>
                <TableHead><span className="txt-container-title"><Trans>Expires</Trans></span></TableHead>
                <TableHead><span className="txt-container-title"><Trans>Created</Trans></span></TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  onRotate={(id) => rotateToken.mutate({ tokenId: id })}
                  onRevoke={(id) => requestRevoke(id)}
                  isRotating={rotateToken.isPending}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
};
