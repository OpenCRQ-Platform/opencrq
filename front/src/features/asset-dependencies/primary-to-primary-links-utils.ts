import { compareText, foldText } from '@app/utils/text-fold';

export const NO_RESOURCE_TYPE = 'none';

export const ANY_RESOURCE_TYPE = 'all';

export interface ResourceTypedLink {
  dependencyResourceTypeId: string | null,
  dependencyResourceTypeName: string | null,
}

export interface ResourceTypeOption {
  value: string,
  /** Null for the option keeping the links without a type. */
  name: string | null,
}

/** Only options that keep a link: the types the links carry, by name, then "no type" when a link has none. */
export const resourceTypeOptions = (links: ReadonlyArray<ResourceTypedLink>): Array<ResourceTypeOption> => {
  const typed = new Map<string, string>();
  for (const link of links) {
    if (link.dependencyResourceTypeId !== null) {
      typed.set(link.dependencyResourceTypeId, link.dependencyResourceTypeName ?? '');
    }
  }
  const options: Array<ResourceTypeOption> = [...typed]
    .map(([value, name]) => ({ value, name }))
    .sort((first, second) => compareText(first.name ?? '', second.name ?? ''));
  return links.some((link) => link.dependencyResourceTypeId === null)
    ? [...options, { value: NO_RESOURCE_TYPE, name: null }]
    : options;
};

export const filterLinksByResourceType = <Link extends ResourceTypedLink>(links: ReadonlyArray<Link>, filter: string): Array<Link> => {
  if (filter === ANY_RESOURCE_TYPE) {
    return [...links];
  }
  return links.filter((link) => (filter === NO_RESOURCE_TYPE ? link.dependencyResourceTypeId === null : link.dependencyResourceTypeId === filter));
};

/** Whether another type already holds the name, compared as the server compares it: case and accents aside. */
export const isResourceTypeNameTaken = (
  types: ReadonlyArray<{ id: string, name: string }>,
  name: string,
  exceptId: string | null,
): boolean => {
  const folded = foldText(name.trim());
  return types.some((type) => type.id !== exceptId && foldText(type.name) === folded);
};
