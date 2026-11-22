import { v5 as uuidv5 } from 'uuid';

export const MARKING_STIX_ID_PREFIX = 'marking-definition--';

/** OpenCTI's OASIS_NAMESPACE (opencti-graphql `schema/general.js`), which pycti and OpenAEV use too. */
const OASIS_NAMESPACE = '00abedb4-aa42-466c-9c01-fed23315a9b7';

/** The static ids OpenCTI ships for the TLP 2.0 markings; TLP:WHITE is an alias of TLP:CLEAR. */
const STATIC_TLP_IDS: Readonly<Record<string, string>> = {
  'TLP:WHITE': `${MARKING_STIX_ID_PREFIX}613f2e26-407d-48c7-9eca-b8e91df99dc9`,
  'TLP:CLEAR': `${MARKING_STIX_ID_PREFIX}613f2e26-407d-48c7-9eca-b8e91df99dc9`,
  'TLP:GREEN': `${MARKING_STIX_ID_PREFIX}34098fce-860f-48ae-8e50-ebd3cc5e41da`,
  'TLP:AMBER': `${MARKING_STIX_ID_PREFIX}f88d31f6-486f-44da-b317-01333bde0b82`,
  'TLP:AMBER+STRICT': `${MARKING_STIX_ID_PREFIX}826578e1-40ad-459f-bc73-ede076f81f37`,
  'TLP:RED': `${MARKING_STIX_ID_PREFIX}5e57c739-391a-4eb3-b6be-7d15ca92d5ed`,
};

const STIX_ID = /^marking-definition--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** OpenCTI upper-cases both members and trims neither (`schema/identifier.js`, `definition` and `definition_type`). */
const upper = (value: string) => value.toUpperCase();

/**
 * The STIX `standard_id` OpenCTI gives a marking of this type and definition, so a marking is one
 * object in OpenCTI, OpenAEV, OpenCRQ and XTM One: the static id for a TLP 2.0 marking, otherwise a
 * UUIDv5 in the OASIS namespace of the canonical JSON (RFC 8785) of the upper-cased definition and
 * type, as opencti-graphql `schema/identifier.js`, pycti `MarkingDefinition.generate_id` and OpenAEV
 * `MarkingDefinitionStixIds.generate` derive it. `JSON.stringify` of two string members with sorted
 * keys is that canonical form.
 */
export const markingStixId = (definitionType: string, definition: string): string => {
  const type = upper(definitionType);
  const value = upper(definition);
  const staticId = type === 'TLP' ? STATIC_TLP_IDS[value] : undefined;
  if (staticId !== undefined) {
    return staticId;
  }
  return `${MARKING_STIX_ID_PREFIX}${uuidv5(JSON.stringify({ definition: value, definition_type: type }), OASIS_NAMESPACE)}`;
};

/** Whether a value is a well-formed STIX marking-definition id. */
export const isMarkingStixId = (value: string): boolean => STIX_ID.test(value);
