import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { TAGS_LIST_SEARCH_DEFAULTS, tagsListSearchSchema } from '../../../../../../../features/supporting-assets/tags-list-search';
import { TagsDataTable } from '../../../../../../../features';

const RouteComponent: FunctionComponent = () => <TagsDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/tags/')({
  validateSearch: tagsListSearchSchema,
  search: { middlewares: [stripSearchParams(TAGS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});
