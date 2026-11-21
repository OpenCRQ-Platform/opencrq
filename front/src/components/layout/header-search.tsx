import { HeaderGroup, SearchField } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useState } from 'react';

/** OpenAEV's top bar search window: the field grows between these bounds with the header. */
const SEARCH_MIN_WIDTH = 200;
const SEARCH_MAX_WIDTH = 500;

/**
 * "Search the platform...", as in OpenAEV and OpenCTI: Enter opens the tenant's search page with the
 * typed text, and the field shows the search on screen when that page is open.
 */
export const HeaderSearch: FunctionComponent<{ tenantId: string }> = ({ tenantId }) => {
  const navigate = useNavigate();
  // Only the search page's own text: a list's filter shares the `search` param name but is not this field's.
  const current = useRouterState({
    select: ({ location }) => (location.pathname.endsWith('/search') ? new URLSearchParams(location.searchStr).get('search') ?? '' : ''),
  });
  const [value, setValue] = useState(current);
  // Follow the page's search when the location changes, without an effect (no cascading render).
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setValue(current);
  }

  const onSubmit = (search?: string) => {
    const trimmed = search?.trim();
    if (trimmed) {
      void navigate({ to: '/$tenantId/{-$organizationId}/search', params: { tenantId }, search: { search: trimmed } });
    }
  };

  return (
    <HeaderGroup grow="unbounded" style={{ minWidth: SEARCH_MIN_WIDTH, maxWidth: SEARCH_MAX_WIDTH }}>
      <SearchField
        aria-label={t`Search the platform`}
        placeholder={t`Search the platform...`}
        clearLabel={t`Clear search`}
        fullWidth
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onSubmit={onSubmit}
        onClear={() => setValue('')}
      />
    </HeaderGroup>
  );
};
