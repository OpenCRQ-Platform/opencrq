import { Spinner } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useDebounce } from 'use-debounce';
import type { DependencyRuleConditionsDraft } from '../dependency-rules-utils';
import { AssetName } from '../../../components/shared/asset-name';
import { useTRPC } from '../../../lib';
import { getAssetCategoryLabel } from '../../../utils';
import { hasAnyCondition, isReadableRegex, toConditionsInput } from '../dependency-rules-utils';

const PREVIEW_DEBOUNCE_MS = 400;

interface DependencyRulePreviewProps {
  primaryAssetId: string | null,
  conditions: DependencyRuleConditionsDraft,
}

/** What the rule would link if saved now, re-read as its conditions change. */
export const DependencyRulePreview: FunctionComponent<DependencyRulePreviewProps> = ({ primaryAssetId, conditions }) => {
  const trpc = useTRPC();
  const [debounced] = useDebounce(conditions, PREVIEW_DEBOUNCE_MS, { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const input = toConditionsInput(debounced);
  const readable = input.namePatternKind !== 'regex' || input.namePattern === null || isReadableRegex(input.namePattern);
  const ready = primaryAssetId !== null && hasAnyCondition(debounced) && readable;
  const preview = useQuery(trpc.assetDependencies.previewDependencyRule.queryOptions(
    { ...input, primaryAssetId: primaryAssetId ?? '' },
    { enabled: ready, placeholderData: (previous) => previous, retry: false },
  ));

  let body;
  if (primaryAssetId === null) {
    body = <Trans>Choose a primary asset to see the assets this rule links.</Trans>;
  } else if (!hasAnyCondition(conditions)) {
    body = <Trans>Add at least one condition: a rule without one would link every supporting asset.</Trans>;
  } else if (!readable) {
    body = <Trans>Fix the name pattern to see the matching assets.</Trans>;
  } else if (preview.isError) {
    body = <span className="text-feedback-error-primary">{preview.error.message}</span>;
  } else if (preview.data === undefined) {
    body = <Spinner label={t`Reading the matching assets`} />;
  } else {
    const { total, alreadyManual, suppressed, assets } = preview.data;
    body = (
      <div className="flex flex-col gap-3">
        <p className="txt-body2">
          {plural(total, { one: 'Links # supporting asset.', other: 'Links # supporting assets.' })}
          {alreadyManual > 0 && ` ${plural(alreadyManual, { one: '# more already linked by hand is left as it is.', other: '# more already linked by hand are left as they are.' })}`}
          {suppressed > 0 && ` ${plural(suppressed, { one: '# more a person unlinked is never linked again.', other: '# more a person unlinked are never linked again.' })}`}
        </p>
        {assets.length > 0 && (
          <ul aria-label={t`Matching assets`} className="flex flex-col divide-y divide-border rounded border border-border">
            {assets.map((asset) => (
              <li key={asset.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <AssetName name={asset.name} derivedName={asset.derivedName} />
                <span className="txt-sub-content text-muted-foreground">{getAssetCategoryLabel(asset.categoryId)}</span>
              </li>
            ))}
          </ul>
        )}
        {total > assets.length && (
          <p className="txt-sub-content text-muted-foreground">
            {plural(assets.length, { one: 'The first # is shown.', other: 'The first # are shown.' })}
          </p>
        )}
      </div>
    );
  }

  return (
    <section aria-live="polite" className="flex flex-col gap-2">
      <h3 className="txt-category">{t`Preview`}</h3>
      <div className="txt-body2 text-default-secondary">{body}</div>
    </section>
  );
};
