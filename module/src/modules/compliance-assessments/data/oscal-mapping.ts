import { newError } from '@app/utils';
import { z } from 'zod';
import type { ControlLinkAxis } from '../constants';
import type { ParsedCatalog } from './oscal-catalog';
import { CONTROL_LINK_AXES } from '../constants';

const OPENCRQ_NAMESPACE = 'https://filigran.io/ns/opencrq';

const OscalPropSchema = z.object({ name: z.string(), ns: z.string().optional(), value: z.string() });
const OscalMapEndSchema = z.object({ type: z.string(), 'id-ref': z.string() });

const OscalMappingCollectionSchema = z.object({
  'mapping-collection': z.object({
    mappings: z.array(z.object({
      'source-resource': z.object({ href: z.string() }),
      maps: z.array(z.object({
        sources: z.array(OscalMapEndSchema).length(1),
        targets: z.array(OscalMapEndSchema).length(1),
        props: z.array(OscalPropSchema).optional(),
      })),
    })),
    'back-matter': z.object({
      resources: z.array(z.object({ uuid: z.string(), props: z.array(OscalPropSchema).optional() })),
    }),
  }),
});

export interface ControlLinkRow {
  requirementId: string,
  capabilityId: string,
  axis: ControlLinkAxis,
}

const opencrqProp = (props: ReadonlyArray<z.infer<typeof OscalPropSchema>> | undefined, name: string) =>
  props?.find((prop) => prop.ns === OPENCRQ_NAMESPACE && prop.name === name)?.value;

const toAxis = (value: string | undefined): ControlLinkAxis | undefined =>
  CONTROL_LINK_AXES.find((axis) => axis === value);

/**
 * Reads an OSCAL mapping-collection whose sources are requirements of `catalog` and whose targets
 * are OpenCRQ control external ids. Throws on anything it cannot resolve, so a mapping drawn
 * against another catalogue or naming a control the product does not ship never seeds a partial table.
 */
export const parseOscalMapping = (
  catalog: ParsedCatalog,
  controls: ReadonlyArray<{ id: string, externalId: string }>,
  raw: unknown,
): Array<ControlLinkRow> => {
  const collection = OscalMappingCollectionSchema.parse(raw)['mapping-collection'];
  const requirementIdByOscalId = new Map(catalog.nodes.filter((node) => node.isRequirement).map((node) => [node.oscalId, node.id]));
  const capabilityIdByExternalId = new Map(controls.map((control) => [control.externalId, control.id]));
  const catalogUuidByResource = new Map(collection['back-matter'].resources.map((resource) => [
    `#${resource.uuid}`,
    opencrqProp(resource.props, 'catalog-uuid'),
  ]));

  const links: Array<ControlLinkRow> = [];
  const seen = new Set<string>();
  for (const mapping of collection.mappings) {
    const sourceCatalogUuid = catalogUuidByResource.get(mapping['source-resource'].href);
    if (sourceCatalogUuid !== catalog.framework.oscalCatalogUuid) {
      throw newError('An OSCAL mapping is drawn against another catalogue', {
        expected: catalog.framework.oscalCatalogUuid,
        found: sourceCatalogUuid ?? null,
      });
    }
    for (const map of mapping.maps) {
      const [source] = map.sources;
      const [target] = map.targets;
      const requirementId = requirementIdByOscalId.get(source['id-ref']);
      if (requirementId === undefined) {
        throw newError('An OSCAL mapping names an unknown requirement', { oscalId: source['id-ref'] });
      }
      const capabilityId = capabilityIdByExternalId.get(target['id-ref']);
      if (capabilityId === undefined) {
        throw newError('An OSCAL mapping names an unknown control', { externalId: target['id-ref'] });
      }
      const axis = toAxis(opencrqProp(map.props, 'axis'));
      if (axis === undefined) {
        throw newError('An OSCAL mapping link carries no axis', { oscalId: source['id-ref'], externalId: target['id-ref'] });
      }
      const key = `${requirementId}:${capabilityId}`;
      if (seen.has(key)) {
        throw newError('An OSCAL mapping links the same pair twice', { oscalId: source['id-ref'], externalId: target['id-ref'] });
      }
      seen.add(key);
      links.push({ requirementId, capabilityId, axis });
    }
  }
  return links;
};
