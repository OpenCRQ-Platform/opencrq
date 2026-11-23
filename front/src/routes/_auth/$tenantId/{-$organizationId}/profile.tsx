import { Button, Chip, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, Input, Switch } from '@filigran/design-system';
import { ExternalLink, Pencil, RotateCcw } from 'lucide-react';
import { Avatar } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { createFileRoute, notFound, useBlocker } from '@tanstack/react-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { SupportedLocale } from '../../../../lib';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { CardField, DetailPageLayout, InfoField, LocaleSettingSelect, SectionCard } from '../../../../components/shared';
import { EmptyValue } from '../../../../components/ui/empty-value';
// Deep import (not the feature barrel): the barrel re-exports the Ask Ariane
// launcher whose `@filigran/chatbot/styles.css` side-effect import would
// otherwise be pulled into the profile route chunk.
import { XtmOneMcpCard } from '../../../../features/xtm-one/components/xtm-one-mcp-card';
import { HomeDashboardField } from '../../../../features/dashboard/components/home-dashboard-field';
import { getThemes, isValidTheme, useTheme } from '../../../../providers';
import { isSupportedLocale, rememberLocale, resolveLocale, trpcClient, useTRPC } from '../../../../lib';

const tenantProfileFormSchema = z.object({
  name: z.string(),
  title: z.string(),
});

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/profile')({
  loader: async ({ params }) => {
    const me = await trpcClient.getMe.query();
    const [user, tenantProfile] = await Promise.all([
      trpcClient.users.getUser.query({ id: me.id }),
      trpcClient.tenants.getTenantUserProfile.query({ tenantId: params.tenantId, userId: me.id }),
    ]);
    if (!user) {
      throw notFound();
    }
    return { user, tenantProfile, crumb: t`Profile` };
  },
  component: function ProfilePage() {
    const trpc = useTRPC();
    const { tenantId } = Route.useParams();
    const { user: initialUser, tenantProfile: initialTenantProfile } = Route.useLoaderData();
    const [isEditing, setIsEditing] = useState(false);
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const { theme } = useTheme();

    const { data: user } = useQuery(trpc.users.getUser.queryOptions({ id: initialUser.id }, {
      initialData: initialUser,
    }));

    const { data: tenantProfile } = useQuery(trpc.tenants.getTenantUserProfile.queryOptions(
      { tenantId, userId: initialUser.id },
      { initialData: initialTenantProfile },
    ));

    const data = user ?? initialUser;

    const { data: xtmOne } = useQuery(trpc.xtmOne.getSettings.queryOptions());
    const xtmOneProfileUrl = xtmOne?.url ? `${xtmOne.url}/profile` : null;

    // Tenant profile form
    const tenantForm = useForm<z.infer<typeof tenantProfileFormSchema>>({
      resolver: zodResolver(tenantProfileFormSchema),
      values: {
        name: tenantProfile?.name ?? '',
        title: tenantProfile?.title ?? '',
      },
    });

    const updateThemeMutation = useMutation(trpc.users.updateUser.mutationOptions({
      meta: { skipSuccessToast: true },
    }));

    const pastelColoursQuery = useQuery(trpc.users.getUserPastelColours.queryOptions());
    const updatePastelColoursMutation = useMutation(trpc.users.updateUser.mutationOptions({
      meta: { skipSuccessToast: true },
      onSuccess: () => pastelColoursQuery.refetch(),
    }));

    const updateTheme = async (newTheme: string) => {
      if (!isValidTheme(newTheme)) {
        return;
      }
      await updateThemeMutation.mutateAsync({ theme: newTheme });
    };

    const { data: tenant } = useQuery(trpc.tenants.getTenant.queryOptions({ id: tenantId }));
    const updateLocaleMutation = useMutation(trpc.users.updateUser.mutationOptions({
      meta: { skipSuccessToast: true },
      onSuccess: (_, { locale }) => {
        rememberLocale(resolveLocale({
          userLocale: locale ?? null,
          tenantLocale: tenant?.defaultLocale ?? null,
          browserLanguages: navigator.languages,
        }));
        window.location.reload();
      },
    }));

    const localeQuery = useQuery(trpc.users.getUserLocale.queryOptions());
    const currentLocale = isSupportedLocale(localeQuery.data) ? localeQuery.data : null;

    const updateTenantProfile = useMutation(trpc.tenants.updateTenantUserProfile.mutationOptions({
      meta: { successMessage: msg`Tenant profile updated.` },
    }));

    const { isDirty: isAnyDirty } = tenantForm.formState;
    const [pendingLocale, setPendingLocale] = useState<{ locale: SupportedLocale | null } | null>(null);

    const handleSave = async () => {
      const tenantValues = tenantForm.getValues();
      if (isAnyDirty) {
        await updateTenantProfile.mutateAsync({
          tenantId,
          userId: data.id,
          name: tenantValues.name || null,
          title: tenantValues.title || null,
        });
      }
      tenantForm.reset(tenantValues);
      setIsEditing(false);
    };

    const handleResetTenantProfile = async () => {
      await updateTenantProfile.mutateAsync({
        tenantId,
        userId: data.id,
        name: null,
        title: null,
      });
      tenantForm.reset({ name: '', title: '' });
    };

    const handleCancel = () => {
      if (isAnyDirty) {
        setShowCancelDialog(true);
      } else {
        tenantForm.reset();
        setIsEditing(false);
      }
    };

    const handleConfirmCancel = () => {
      tenantForm.reset();
      setIsEditing(false);
      setShowCancelDialog(false);
    };

    const blocker = useBlocker({
      shouldBlockFn: () => isEditing && isAnyDirty,
      withResolver: true,
      enableBeforeUnload: isEditing && isAnyDirty,
    });

    const effectiveName = tenantProfile?.name ?? data.name;
    const effectiveTitle = tenantProfile?.title ?? data.title;
    const displayName = effectiveName ?? data.email;
    const hasTenantOverrides = tenantProfile?.name != null || tenantProfile?.title != null;
    // A super administrator reaches the tenant with no membership, so has no tenant profile to edit.
    const isTenantMember = tenantProfile != null;

    return (
      <DetailPageLayout
        title={displayName}
        actions={
          isEditing ? (
            <div className="flex gap-2">
              <Button priority="secondary" onClick={handleCancel}>{t`Cancel`}</Button>
              <Button startIcon={<Pencil className="size-4" />} onClick={handleSave}>{t`Save`}</Button>
            </div>
          ) : isTenantMember && (
            <Button priority="secondary" startIcon={<Pencil className="size-4" />} onClick={() => setIsEditing(true)}>
              {t`Edit profile`}
            </Button>
          )
        }
      >
        {/* Avatar + subtitle */}
        <div className="flex items-center gap-4 -mt-2">
          <div className="size-16 shrink-0">
            <Avatar src={undefined} />
          </div>
          <div className="flex flex-col">
            {effectiveTitle && <span className="txt-sub-content text-muted-foreground">{effectiveTitle}</span>}
            <span className="txt-sub-content text-muted-foreground">{data.email}</span>
          </div>
        </div>

        {/* Global profile: XTM One's, read at each sign-in */}
        <SectionCard
          title={t`Global profile`}
          headerAction={(
            <div className="flex items-center gap-3">
              <Chip label={t`Managed in XTM One`} />
              {xtmOneProfileUrl && (
                <a href={xtmOneProfileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {t`Edit in XTM One`}
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              )}
            </div>
          )}
        >
          <div className="grid grid-cols-2 gap-6">
            <InfoField title={t`Full name`} value={data.name} />
            <InfoField title={t`Title`} value={data.title} />
            <InfoField title={t`Email`} value={data.email} />
          </div>
        </SectionCard>

        {/* Tenant Profile */}
        <SectionCard
          title={t`Tenant profile`}
          headerAction={hasTenantOverrides && !isEditing && (
            <Button priority="secondary" startIcon={<RotateCcw className="size-4" />} onClick={handleResetTenantProfile}>
              {t`Reset to global`}
            </Button>
          )}
        >
          {isEditing ? (
            <div className="flex flex-col gap-4">
              <Controller
                control={tenantForm.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Input {...field} label={t`Full name`} placeholder={data.name ?? t`Full name`} error={fieldState.error?.message} />
                )}
              />
              <Controller
                control={tenantForm.control}
                name="title"
                render={({ field, fieldState }) => (
                  <Input {...field} label={t`Title`} placeholder={data.title ?? t`Job title`} error={fieldState.error?.message} />
                )}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <CardField title={t`Full name`}>
                <div className="flex items-center gap-2">
                  <p>{effectiveName ?? <EmptyValue />}</p>
                  {tenantProfile?.name != null ? (
                    <Chip severity="info" label={t`Overridden`} />
                  ) : (
                    <Chip label={t`Inherited`} />
                  )}
                </div>
              </CardField>
              <CardField title={t`Title`}>
                <div className="flex items-center gap-2">
                  <p>{effectiveTitle ?? <EmptyValue />}</p>
                  {tenantProfile?.title != null ? (
                    <Chip severity="info" label={t`Overridden`} />
                  ) : (
                    <Chip label={t`Inherited`} />
                  )}
                </div>
              </CardField>
            </div>
          )}
        </SectionCard>

        {/* Preferences */}
        <SectionCard title={t`Preferences`}>
          <div className="grid grid-cols-2 gap-6">
            <CardField title={t`Language`}>
              <LocaleSettingSelect
                value={currentLocale}
                onValueChange={(locale) => {
                  if (locale !== currentLocale) {
                    setPendingLocale({ locale });
                  }
                }}
                ariaLabel={t`Language`}
                disabled={!localeQuery.isSuccess}
                className="w-[200px]"
              />
            </CardField>
            <CardField title={t`Theme`}>
              <Select
                value={theme}
                onValueChange={updateTheme}
              >
                <SelectTrigger className="w-[200px]" aria-label={t`Theme`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getThemes().map((th) => (
                    <SelectItem key={th.value} value={th.value}>
                      {th.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardField>
            <CardField title={t`Pastel colours`}>
              {/* The 36 px control line of the selects next to it: a short label keeps the switch on it in every
                  language; the explanation is a muted description below the line (the Switch composes no helper text). */}
              <div className="flex h-9 items-center">
                <Switch
                  checked={pastelColoursQuery.data === true}
                  onCheckedChange={(checked) => {
                    void updatePastelColoursMutation.mutateAsync({ pastelColours: checked });
                  }}
                  disabled={!pastelColoursQuery.isSuccess || updatePastelColoursMutation.isPending}
                  label={t`Softer tones`}
                  aria-describedby="profile-pastel-colours-description"
                />
              </div>
              <p id="profile-pastel-colours-description" className="txt-sub-content mt-1 text-muted-foreground">
                {t`Softer tones for severity, status and marking colours. Off: standard colours, the same in every product.`}
              </p>
            </CardField>
            <CardField title={t`Home dashboard`}>
              <HomeDashboardField />
            </CardField>
          </div>
        </SectionCard>

        {/* XTM One MCP server (shown only when XTM One is connected) */}
        <XtmOneMcpCard />

        {/* Unsaved Changes Dialog — navigation */}
        {blocker.status === 'blocked' && (
          <Dialog open onOpenChange={() => blocker.reset()}>
            <DialogContent size="sm">
              <DialogTitle>{t`Unsaved changes`}</DialogTitle>
              <DialogDescription>
                {t`You have unsaved changes. Do you want to discard them?`}
              </DialogDescription>
              <DialogFooter>
                <DialogClose asChild>
                  <Button priority="secondary" onClick={() => blocker.reset()}>{t`Cancel`}</Button>
                </DialogClose>
                <Button onClick={() => blocker.proceed()}>{t`Discard`}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Language change — reload required */}
        <Dialog
          open={pendingLocale !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingLocale(null);
            }
          }}>
          <DialogContent size="sm">
            <DialogTitle>{t`Language change`}</DialogTitle>
            <DialogDescription>
              {t`The application needs to reload to apply the new language.`}
            </DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button priority="secondary" onClick={() => setPendingLocale(null)}>{t`Cancel`}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  disabled={updateLocaleMutation.isPending}
                  onClick={() => {
                    const { locale } = pendingLocale!;
                    void updateLocaleMutation.mutateAsync({ locale })
                      .catch(() => setPendingLocale(null));
                  }}
                >{updateLocaleMutation.isPending ? t`Loading...` : t`Reload`}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unsaved Changes Dialog — cancel editing */}
        <Dialog open={showCancelDialog} onOpenChange={() => setShowCancelDialog(false)}>
          <DialogContent size="sm">
            <DialogTitle>{t`Unsaved changes`}</DialogTitle>
            <DialogDescription>
              {t`You have unsaved changes. Do you want to discard them?`}
            </DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button priority="secondary">{t`Cancel`}</Button>
              </DialogClose>
              <Button onClick={handleConfirmCancel}>{t`Discard`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DetailPageLayout>
    );
  },
});
