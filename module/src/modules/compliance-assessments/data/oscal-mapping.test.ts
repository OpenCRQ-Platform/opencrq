import { describe, expect, it } from 'vitest';
import { controlCapabilitiesData, controlCapabilityCrosswalkData } from '../../controls/capability/data/capabilities.generated';
import { BUNDLED_CATALOGS, BUNDLED_CONTROL_LINKS } from './compliance-frameworks-seed';
import nistCsf20ControlMapping from './nist-csf-2.0-control-mapping.json';
import { parseOscalMapping } from './oscal-mapping';

const [nistCsf] = BUNDLED_CATALOGS;
const links = BUNDLED_CONTROL_LINKS.get(nistCsf.framework.id) ?? [];
const codeByRequirementId = new Map(nistCsf.nodes.map((node) => [node.id, node.code]));
const externalIdByCapabilityId = new Map(controlCapabilitiesData.map((control) => [control.id, control.externalId]));
const pairOf = (requirementCode: string | undefined, externalId: string | undefined) => `${requirementCode} → ${externalId}`;

type MappingFile = typeof nistCsf20ControlMapping;

const withFirstMap = (edit: (map: MappingFile['mapping-collection']['mappings'][number]['maps'][number]) => void): MappingFile => {
  const copy = structuredClone(nistCsf20ControlMapping);
  const [first] = copy['mapping-collection'].mappings[0].maps;
  edit(first);
  return copy;
};

const parse = (raw: unknown) => parseOscalMapping(nistCsf, controlCapabilitiesData, raw);

describe('the NIST CSF 2.0 control mapping', () => {
  it('links 35 requirements to all 51 controls through 169 links', () => {
    expect(links).toHaveLength(169);
    expect(new Set(links.map((link) => link.requirementId)).size).toBe(35);
    expect(new Set(links.map((link) => link.capabilityId)).size).toBe(51);
  });

  it('holds exactly the pairs of the capability catalogue\'s csf_2_0 crosswalk', () => {
    const mapped = links.map((link) => pairOf(codeByRequirementId.get(link.requirementId), externalIdByCapabilityId.get(link.capabilityId)));
    const crosswalk = controlCapabilityCrosswalkData
      .filter((row) => row.framework === 'csf_2_0')
      .map((row) => pairOf(row.externalId, externalIdByCapabilityId.get(row.capabilityId)));

    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual([...new Set(crosswalk)].sort());
  });

  it('keeps a capability link for every control it reaches', () => {
    const controls = new Set(links.map((link) => link.capabilityId));
    const withCapability = new Set(links.filter((link) => link.axis === 'capability').map((link) => link.capabilityId));

    expect([...controls].filter((id) => !withCapability.has(id)).map((id) => externalIdByCapabilityId.get(id))).toEqual([]);
  });

  it('feeds the authenticating controls from PR.AA-03, and nothing from Govern', () => {
    const fedBy = (code: string) => links
      .filter((link) => codeByRequirementId.get(link.requirementId) === code)
      .map((link) => externalIdByCapabilityId.get(link.capabilityId))
      .sort();

    expect(fedBy('PR.AA-03')).toEqual(['AIGW', 'APPH', 'CLDH', 'IDP', 'ITDR', 'NAC', 'SAASH', 'WAF', 'WIFI', 'ZTNA']);
    expect(links.some((link) => codeByRequirementId.get(link.requirementId)?.startsWith('GV.'))).toBe(false);
  });

  it('refuses a link to an unknown requirement or control, without an axis, or twice the same pair', () => {
    expect(() => parse(withFirstMap((map) => {
      map.sources[0]['id-ref'] = 'PR.ZZ-99';
    }))).toThrow('unknown requirement');
    expect(() => parse(withFirstMap((map) => {
      map.sources[0]['id-ref'] = 'PR.AA';
    }))).toThrow('unknown requirement');
    expect(() => parse(withFirstMap((map) => {
      map.targets[0]['id-ref'] = 'NOPE';
    }))).toThrow('unknown control');
    expect(() => parse(withFirstMap((map) => {
      map.props = [];
    }))).toThrow('no axis');

    const duplicated = structuredClone(nistCsf20ControlMapping);
    const maps = duplicated['mapping-collection'].mappings[0].maps;
    maps.push(structuredClone(maps[0]));
    expect(() => parse(duplicated)).toThrow('same pair twice');
  });

  it('refuses a mapping drawn against another catalogue', () => {
    const foreign = structuredClone(nistCsf20ControlMapping);
    for (const resource of foreign['mapping-collection']['back-matter'].resources) {
      resource.props = resource.props.map((prop) => (prop.name === 'catalog-uuid' ? { ...prop, value: '00000000-0000-4000-8000-000000000000' } : prop));
    }

    expect(() => parse(foreign)).toThrow('another catalogue');
  });
});
