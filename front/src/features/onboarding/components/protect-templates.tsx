import { Button, Card, CardHeader, CardMetaBar, CardOverview, CardTitle, Chip } from '@filigran/design-system';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Factory, Landmark, Lightbulb, Mail, Plus, UserRound, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { uuidv7 } from 'uuidv7';
import type { ProtectTemplate, ProtectTemplateKey } from '../protect-utils';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { useConfirmationDialog } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { businessResourceName } from '../../business-value-categories';
import { PrimaryAssetCreateSheet } from '../../primary-assets';
import { protectTemplateName } from '../protect-labels';
import { findCategoryId, findTemplateAsset, PROTECT_TEMPLATES } from '../protect-utils';
import { SourceGlyph } from './source-tile';

const TEMPLATE_ICONS: Record<ProtectTemplateKey, LucideIcon> = {
  'customer-data': Users,
  'payments-and-treasury': Landmark,
  'production-and-operations': Factory,
  'hr-data': UserRound,
  'intellectual-property': Lightbulb,
  'email-and-collaboration': Mail,
};

export interface LinkTarget {
  id: string,
  name: string,
}

interface ProtectTemplatesProps {
  organizationId: string,
  assets: ReadonlyArray<{ id: string, name: string, onboardingTemplate: ProtectTemplateKey | null }>,
  onLink: (asset: LinkTarget) => void,
}

export const ProtectTemplates: FunctionComponent<ProtectTemplatesProps> = ({ organizationId, assets, onLink }) => {
  const trpc = useTRPC();
  const [creating, setCreating] = useState<ReadonlyArray<ProtectTemplateKey>>([]);
  const [addingOwn, setAddingOwn] = useState(false);
  const confirmation = useConfirmationDialog();
  const { data: categories } = useQuery(trpc.businessValueCategories.getBusinessValueCategories.queryOptions());
  const createPrimaryAsset = useMutation(trpc.primaryAssets.createPrimaryAsset.mutationOptions({
    meta: { skipSuccessToast: true },
    onError: (_, { onboardingTemplate }) => setCreating((keys) => keys.filter((key) => key !== onboardingTemplate)),
  }));
  const deletePrimaryAssets = useMutation(trpc.primaryAssets.deletePrimaryAssets.mutationOptions({
    meta: { successMessage: msg`Primary asset deleted successfully.` },
  }));

  // The list refreshes through the doorbell, a moment after the write: a card stays busy until it shows its asset.
  const stillCreating = creating.filter((key) => findTemplateAsset(assets, key) === undefined);
  if (stillCreating.length !== creating.length) {
    setCreating(stillCreating);
  }

  const create = (template: ProtectTemplate, categoryId: string) => {
    setCreating((keys) => [...keys, template.key]);
    createPrimaryAsset.mutate({
      id: uuidv7(),
      organizationId,
      name: protectTemplateName(template.key),
      description: null,
      ownerId: null,
      businessValueCategoryIds: [categoryId],
      onboardingTemplate: template.key,
    });
  };

  const confirmRemove = () => {
    const id = confirmation.confirm();
    if (id !== null) {
      deletePrimaryAssets.mutate([id]);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 items-stretch gap-4">
        {PROTECT_TEMPLATES.map((template) => {
          const name = protectTemplateName(template.key);
          const added = findTemplateAsset(assets, template.key);
          const categoryId = categories === undefined ? undefined : findCategoryId(categories, template.categoryCode);
          const category = categories?.find((candidate) => candidate.code === template.categoryCode);
          const isCreating = creating.includes(template.key);
          const onClick = added === undefined ? () => categoryId !== undefined && create(template, categoryId) : undefined;
          const chip = added !== undefined
            ? <Chip severity="low" label={t({ message: 'Added', context: 'a primary asset already in the scope' })} />
            : isCreating ? <Chip label={t`Adding…`} /> : undefined;

          return (
            <Card key={template.key} padding={16} gap={16} onClick={onClick} disabled={onClick !== undefined && (categoryId === undefined || isCreating)}>
              <CardHeader icon={<SourceGlyph icon={TEMPLATE_ICONS[template.key]} />} action={chip}>
                <CardOverview>{category === undefined ? '' : businessResourceName(category)}</CardOverview>
                <CardTitle as="h3">{name}</CardTitle>
              </CardHeader>
              {added !== undefined && (
                <CardMetaBar className="justify-end gap-2">
                  <Button type="button" priority="secondary" size="sm" disabled={deletePrimaryAssets.isPending} onClick={() => confirmation.requestConfirmation(added.id)}>{t`Remove`}</Button>
                  <Button type="button" priority="secondary" size="sm" onClick={() => onLink({ id: added.id, name: added.name })}>{t`Link assets`}</Button>
                </CardMetaBar>
              )}
            </Card>
          );
        })}
        <Card padding={16} gap={16} onClick={() => setAddingOwn(true)}>
          <CardHeader icon={<SourceGlyph icon={Plus} />}>
            <CardOverview>{t`Name it and pick its category`}</CardOverview>
            <CardTitle as="h3">{t`Add your own`}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <PrimaryAssetCreateSheet organizationId={organizationId} open={addingOwn} onOpenChange={setAddingOwn} />
      <DeleteConfirmDialog
        open={confirmation.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            confirmation.cancel();
          }
        }}
        onConfirm={confirmRemove}
        title={<Trans>Delete primary asset</Trans>}
        description={<Trans>This will permanently delete this primary asset and everything attached to it. This action cannot be undone.</Trans>}
      />
    </>
  );
};
