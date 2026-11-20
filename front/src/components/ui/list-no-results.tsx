import { Button, Card, Text } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';

/**
 * A search or a filter that matched nothing: the toolbar above stays, so the reader can loosen it,
 * and this card offers to lift every one of them at once. Distinct from the empty card a list shows
 * when it holds no row at all.
 */
export const ListNoResults: FunctionComponent<{ onClearFilters: () => void }> = ({ onClearFilters }) => (
  <Card>
    <div className="flex flex-col items-center gap-2 py-10">
      <Text as="p" variant="content-compact"><Trans>No results</Trans></Text>
      <Button type="button" priority="secondary" onClick={onClearFilters}><Trans>Clear filters</Trans></Button>
    </div>
  </Card>
);
