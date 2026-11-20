import {
  Combobox,
  ComboboxChips,
  ComboboxClear,
  ComboboxControls,
  ComboboxField,
  ComboboxHelperText,
  ComboboxInput,
  ComboboxLabel,
  ComboboxTrigger,
} from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { ReactNode } from 'react';
import type { Control, FieldValues } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import type { AssetTagOption } from './asset-tags-form-utils';
import { ComboboxPanel } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { filterOptionsByLabel, tagColorHex } from '../../../utils';
import { createTagFromInput } from './asset-tags-form-utils';

export const assetTagsFormSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
}));

// Case-sensitive, as `normalizeManualTagNames` and `tags_tenant_name_uq` are: a tenant can hold both `Production` and `production`.
const isSameTagName = (a: AssetTagOption, b: AssetTagOption): boolean => a.name.trim() === b.name.trim();

export interface AssetTagsFormFields extends FieldValues {
  tags: Array<AssetTagOption>,
}

interface AssetTagsFieldProps<TFieldValues extends AssetTagsFormFields> {
  control: Control<TFieldValues>,
}

/**
 * The tag picker shared by the create and update drawers: a client's own tags, not only a
 * connector's, need a way in. `listTags` supplies the tenant's whole vocabulary; typing a name it
 * does not carry offers to create it, resolved on the backend by name alone.
 *
 * Labelled "Your tags", not "Tags": the field only ever prefills with the manual author's own
 * links (see `assetTagsFormValuesFrom`), since submitting replaces exactly that set. A
 * connector-reported tag the detail page shows is deliberately absent here, and the label plus
 * helper text are what keep that reading as intentional rather than a rendering bug.
 */
export const AssetTagsField = <TFieldValues extends AssetTagsFormFields>({
  control: genericControl,
}: AssetTagsFieldProps<TFieldValues>): ReactNode => {
  const trpc = useTRPC();
  // Same narrowing as `AssetCategoryFields`: `TFieldValues` always carries this exact `tags` shape.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- TFieldValues extends AssetTagsFormFields, so this narrowing only restates the generic constraint
  const control = genericControl as unknown as Control<AssetTagsFormFields>;
  const { data: tagOptions } = useQuery(trpc.supportingAssets.listTags.queryOptions());

  return (
    <Controller
      control={control}
      name="tags"
      render={({ field, fieldState }) => (
        <Combobox
          multiple
          options={tagOptions ?? []}
          value={field.value}
          onValueChange={(next) => field.onChange(next ?? [])}
          getOptionLabel={(option) => option.name}
          filterOptions={filterOptionsByLabel((option) => option.name)}
          isOptionEqualToValue={isSameTagName}
          getChipColor={(option) => option.color ?? tagColorHex(option.name)}
          allowCustomValue
          createValueFromInput={createTagFromInput}
          // Typographic quotes, not ASCII ones: an apostrophe opens a quoted literal in ICU
          // MessageFormat, so `'{input}'` renders the placeholder's own name instead of the value.
          createOptionLabel={(input) => t`Create “${input}”`}
          createHintLabel={(input) => t`Press Enter to add “${input}”`}
          error={fieldState.invalid}
        >
          <ComboboxLabel>{t`Your tags`}</ComboboxLabel>
          <ComboboxField>
            <ComboboxChips aria-label={t`Your tags`} />
            <ComboboxInput ref={field.ref} onBlur={field.onBlur} placeholder={t`Add a tag…`} />
            <ComboboxControls>
              <ComboboxClear aria-label={t`Clear the selection`} />
              <ComboboxTrigger aria-label={t`Toggle the options`} />
            </ComboboxControls>
          </ComboboxField>
          <ComboboxPanel emptyMessage={t`No tags found`} listAriaLabel={t`Suggestions`} />
          <ComboboxHelperText>{fieldState.error?.message ?? t`Tags reported by a connector aren't shown here — they follow their own sync and can't be edited by hand.`}</ComboboxHelperText>
        </Combobox>
      )}
    />
  );
};
