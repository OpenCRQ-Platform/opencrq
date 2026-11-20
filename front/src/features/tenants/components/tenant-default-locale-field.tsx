import { Text } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Info } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { LocaleSettingSelect, SettingsField, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { useHasManageSecurity } from '../../../hooks';
import {
  getLocaleSettingOptions,
  i18n,
  rememberLocale,
  resolveLocale,
  toLocaleSelectValue,
  useTRPC,
} from '../../../lib';

export const TenantDefaultLocaleField: FunctionComponent<{ tenantId: string }> = ({ tenantId }) => {
  const trpc = useTRPC();
  const canManage = useHasManageSecurity();
  const { data: tenant } = useQuery(trpc.tenants.getTenant.queryOptions({ id: tenantId }));
  const { data: userLocale } = useQuery(trpc.users.getUserLocale.queryOptions());
  const setDefaultLocale = useMutation(trpc.tenants.setTenantDefaultLocale.mutationOptions({
    meta: { successMessage: msg`Tenant default language updated.` },
    onSuccess: (_, { locale }) => {
      const shown = resolveLocale({ userLocale: userLocale ?? null, tenantLocale: locale, browserLanguages: navigator.languages });
      if (shown !== i18n.locale) {
        rememberLocale(shown);
        window.location.reload();
      }
    },
  }));
  const hint = t`Shown to every user who has not chosen their own language. Automatic follows each user's browser.`;
  const stored = tenant?.defaultLocale ?? null;
  const value = setDefaultLocale.isPending ? setDefaultLocale.variables.locale : stored;
  const shownLabel = getLocaleSettingOptions().find((option) => option.value === toLocaleSelectValue(stored));

  return (
    <SettingsField
      label={(
        <>
          <Trans>Default language</Trans>
          <TooltipHintProvider>
            <TooltipHint hint={hint}>
              <button
                type="button"
                aria-label={hint}
                className="inline-flex size-4 cursor-help items-center justify-center border-0 bg-transparent p-0 text-default-secondary hover:text-default-primary"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipHint>
          </TooltipHintProvider>
        </>
      )}
    >
      {canManage ? (
        <LocaleSettingSelect
          value={value}
          disabled={setDefaultLocale.isPending || tenant === undefined}
          onValueChange={(locale) => setDefaultLocale.mutate({ locale })}
          ariaLabel={t`Default language`}
          className="w-full"
        />
      ) : (
        <Text as="p" variant="content-base" className={shownLabel?.isAutomatic ? 'italic' : undefined}>{shownLabel?.label}</Text>
      )}
    </SettingsField>
  );
};
