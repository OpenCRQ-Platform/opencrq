import type { FakeStreamEvent, FakeStreamEventType } from './fake-opencti-stream';

type StixObject = Record<string, unknown>;

export const PRODUCER_STIX_ID = 'identity--0b8f5d3e-8f0a-4a2f-9a1d-1f3a0c9e1a01';
export const SURVIVOR_STIX_ID = 'intrusion-set--1a2b3c4d-0000-4000-8000-000000000001';
export const ABSORBED_STIX_ID = 'intrusion-set--1a2b3c4d-0000-4000-8000-000000000002';
export const PHISHING_STIX_ID = 'attack-pattern--2b3c4d5e-0000-4000-8000-000000000001';
export const SCRIPTING_STIX_ID = 'attack-pattern--2b3c4d5e-0000-4000-8000-000000000002';
export const FRANCE_STIX_ID = 'location--3c4d5e6f-0000-4000-8000-000000000001';
export const SURVIVOR_USES_PHISHING_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000001';
export const SURVIVOR_TARGETS_FRANCE_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000002';
export const ABSORBED_USES_SCRIPTING_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000003';
export const RETIRED_STIX_ID = 'intrusion-set--1a2b3c4d-0000-4000-8000-000000000003';
export const REGENERATED_STIX_ID = 'intrusion-set--1a2b3c4d-0000-4000-8000-000000000004';
export const RETIRED_USES_SCRIPTING_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000004';

export const ACTOR_GROUP_STIX_ID = 'threat-actor--5e6f7081-0000-4000-8000-000000000001';
export const ACTOR_GROUP_BIS_STIX_ID = 'threat-actor--5e6f7081-0000-4000-8000-000000000002';
export const ACTOR_INDIVIDUAL_STIX_ID = 'threat-actor--5e6f7081-0000-4000-8000-000000000003';
export const RENAMED_ACTOR_STIX_ID = 'threat-actor--5e6f7081-0000-4000-8000-000000000004';
export const CAMPAIGN_STIX_ID = 'campaign--6f708192-0000-4000-8000-000000000001';
export const PERSONA_STIX_ID = 'identity--0b8f5d3e-8f0a-4a2f-9a1d-1f3a0c9e1a02';
export const CAMPAIGN_USES_PHISHING_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000005';
export const CAMPAIGN_USES_SCRIPTING_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000006';
export const CAMPAIGN_ATTRIBUTED_TO_SET_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000007';
export const CAMPAIGN_ATTRIBUTED_TO_GROUP_BIS_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000008';
export const GROUP_ATTRIBUTED_TO_PERSONA_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000009';
export const ACTOR_GROUP_USES_PHISHING_ID = 'relationship--4d5e6f70-0000-4000-8000-000000000010';

export const PHISHING_MITRE_ID = 'T1566';
export const SCRIPTING_MITRE_ID = 'T1059';
export const SURVIVOR_NAME = 'Fixture Bear';
export const SURVIVOR_RENAMED = 'Fixture Bear (renamed upstream)';
export const RETIRED_NAME = 'Fixture Wolf 2024';
export const REGENERATED_NAME = 'Fixture Wolf';
export const ACTOR_GROUP_NAME = 'Fixture Crew';
export const ACTOR_GROUP_BIS_NAME = 'Fixture Crew bis';
export const ACTOR_INDIVIDUAL_NAME = 'Fixture Lone Wolf';
export const RENAMED_ACTOR_NAME = 'Fixture Crew (renamed upstream)';
export const CAMPAIGN_NAME = 'Operation Fixture';
export const ACTOR_GROUP_DESCRIPTION = 'A crew whose description changed upstream.';

const producer: StixObject = {
  id: PRODUCER_STIX_ID,
  type: 'identity',
  spec_version: '2.1',
  name: 'Fixture Threat Intel',
  identity_class: 'organization',
};

const threat = (id: string, name: string, mitreGroupId: string | null, type = 'intrusion-set'): StixObject => ({
  id,
  type,
  spec_version: '2.1',
  name,
  description: `${name}, a hand-written fixture actor.`,
  created: '2024-01-01T00:00:00.000Z',
  modified: '2024-06-01T00:00:00.000Z',
  first_seen: '2024-01-01T00:00:00.000Z',
  last_seen: '2024-06-01T00:00:00.000Z',
  confidence: 90,
  primary_motivation: 'organizational-gain',
  resource_level: 'government',
  created_by_ref: PRODUCER_STIX_ID,
  ...(mitreGroupId === null ? {} : { external_references: [{ source_name: 'mitre-attack', external_id: mitreGroupId }] }),
});

const attackPattern = (id: string, name: string, mitreExternalId: string): StixObject => ({
  id,
  type: 'attack-pattern',
  spec_version: '2.1',
  name,
  external_references: [{ source_name: 'mitre-attack', external_id: mitreExternalId }],
});

const location: StixObject = {
  id: FRANCE_STIX_ID,
  type: 'location',
  spec_version: '2.1',
  name: 'France',
  country: 'France',
};

// OpenCTI exports a threat actor group and an individual both as STIX `threat-actor`, and says
// which one only in its own extension.
const threatActor = (id: string, name: string, openctiType: 'Threat-Actor-Group' | 'Threat-Actor-Individual'): StixObject => ({
  ...threat(id, name, null, 'threat-actor'),
  extensions: { 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba': { type: openctiType } },
});

const relationship = (id: string, relationshipType: string, sourceRef: string, targetRef: string): StixObject => ({
  id,
  type: 'relationship',
  spec_version: '2.1',
  relationship_type: relationshipType,
  source_ref: sourceRef,
  target_ref: targetRef,
  created: '2024-02-01T00:00:00.000Z',
  modified: '2024-02-01T00:00:00.000Z',
  start_time: '2024-02-01T00:00:00.000Z',
  confidence: 90,
  created_by_ref: PRODUCER_STIX_ID,
});

const SURVIVOR_OBJECT = threat(SURVIVOR_STIX_ID, SURVIVOR_NAME, 'G9101');
const ABSORBED_OBJECT = threat(ABSORBED_STIX_ID, 'Fixture Bear bis', 'G9102');

export interface StreamFixture {
  /** The catalogue and the two actors, as a stream that has never seen them before states them. */
  creates: Array<FakeStreamEvent>,
  /** The rename, the dropped `targets` edge and the merge, published once `creates` has landed. */
  changes: Array<FakeStreamEvent>,
  /**
   * The survivor deleted and created again under the same id. The shape a real platform serves: a
   * deletion fans out to nothing, so its relationships are never named, and the re-creation carries
   * only the edges the platform still holds, as the dependencies of the actor's own event.
   */
  deleteAndRecreate: Array<FakeStreamEvent>,
  all: Array<FakeStreamEvent>,
}

/**
 * Ids are handed out against `startedAt` so every event reads as seconds old: the consumer only
 * ingests on an idle flush once an event's own timestamp puts it at the stream's live tail.
 */
const eventFactory = (startedAt: number) => {
  let sequence = 0;
  return (type: FakeStreamEventType, payload: unknown): FakeStreamEvent => {
    sequence += 1;
    return { id: `${startedAt + sequence}-0`, event: type, payload };
  };
};

export const buildStreamFixture = (startedAt: number = Date.now() - 60_000): StreamFixture => {
  const event = eventFactory(startedAt);
  const created = (object: StixObject): FakeStreamEvent => event('create', { data: object });

  const creates = [
    created(producer),
    created(SURVIVOR_OBJECT),
    created(attackPattern(PHISHING_STIX_ID, 'Phishing', PHISHING_MITRE_ID)),
    created(location),
    created(relationship(SURVIVOR_USES_PHISHING_ID, 'uses', SURVIVOR_STIX_ID, PHISHING_STIX_ID)),
    created(relationship(SURVIVOR_TARGETS_FRANCE_ID, 'targets', SURVIVOR_STIX_ID, FRANCE_STIX_ID)),
    created(ABSORBED_OBJECT),
    created(attackPattern(SCRIPTING_STIX_ID, 'Command and Scripting Interpreter', SCRIPTING_MITRE_ID)),
    created(relationship(ABSORBED_USES_SCRIPTING_ID, 'uses', ABSORBED_STIX_ID, SCRIPTING_STIX_ID)),
  ];

  const changes = [
    event('update', {
      data: { ...SURVIVOR_OBJECT, name: SURVIVOR_RENAMED },
      context: {
        patch: [{ op: 'replace', path: '/name', value: SURVIVOR_RENAMED }],
        reverse_patch: [{ op: 'replace', path: '/name', value: SURVIVOR_NAME }],
      },
    }),
    // The only event served over two `data:` lines. Nothing else drops the France claim, so an
    // empty location set is what proves the client reassembled the frame.
    {
      ...event('delete', { data: relationship(SURVIVOR_TARGETS_FRANCE_ID, 'targets', SURVIVOR_STIX_ID, FRANCE_STIX_ID) }),
      splitData: true,
    },
    event('merge', {
      data: { ...SURVIVOR_OBJECT, name: SURVIVOR_RENAMED },
      context: { sources: [ABSORBED_OBJECT] },
    }),
  ];

  const deleteAndRecreate = [
    event('delete', { data: SURVIVOR_OBJECT }),
    created(SURVIVOR_OBJECT),
    created(relationship(SURVIVOR_USES_PHISHING_ID, 'uses', SURVIVOR_STIX_ID, PHISHING_STIX_ID)),
  ];

  return { creates, changes, deleteAndRecreate, all: [...creates, ...changes] };
};

export interface RenameFixture {
  /** The actor under the id its former name derived, and the technique it is said to use. */
  creates: Array<FakeStreamEvent>,
  /** The rename: the same actor under a regenerated id, the retired one named by `reverse_patch`. */
  rename: Array<FakeStreamEvent>,
}

/**
 * Identity resolution matches on the STIX id, then the MITRE group id, then a whole shared name or
 * alias: neither record carries a group id and neither name is the other, so nothing folds the
 * regenerated actor onto the retired one and hides whether the rename was followed at all.
 */
export const buildRenameFixture = (startedAt: number = Date.now() - 60_000): RenameFixture => {
  const event = eventFactory(startedAt);
  const created = (object: StixObject): FakeStreamEvent => event('create', { data: object });
  const regenerated = threat(REGENERATED_STIX_ID, REGENERATED_NAME, null);

  const creates = [
    created(producer),
    created(threat(RETIRED_STIX_ID, RETIRED_NAME, null)),
    created(attackPattern(SCRIPTING_STIX_ID, 'Command and Scripting Interpreter', SCRIPTING_MITRE_ID)),
    created(relationship(RETIRED_USES_SCRIPTING_ID, 'uses', RETIRED_STIX_ID, SCRIPTING_STIX_ID)),
  ];

  const rename = [
    event('update', {
      data: regenerated,
      context: {
        patch: [
          { op: 'replace', path: '/id', value: REGENERATED_STIX_ID },
          { op: 'replace', path: '/name', value: REGENERATED_NAME },
        ],
        reverse_patch: [
          { op: 'replace', path: '/id', value: RETIRED_STIX_ID },
          { op: 'replace', path: '/name', value: RETIRED_NAME },
        ],
      },
    }),
  ];

  return { creates, rename };
};

export interface ThreatFixture {
  /** A group, a second group, an individual, a campaign and an intrusion set, with their edges. */
  creates: Array<FakeStreamEvent>,
  /** A description edited, a technique added to the campaign, and the second group merged into the first. */
  changes: Array<FakeStreamEvent>,
  /** The first group renamed to a regenerated id, and the campaign deleted. */
  renameAndDelete: Array<FakeStreamEvent>,
}

/**
 * The persona is an `individual` identity, which the mirror drops, so the `attributed-to` the first
 * group carries toward it has one end the mirror never holds.
 */
export const buildThreatFixture = (startedAt: number = Date.now() - 60_000): ThreatFixture => {
  const event = eventFactory(startedAt);
  const created = (object: StixObject): FakeStreamEvent => event('create', { data: object });
  const group = threatActor(ACTOR_GROUP_STIX_ID, ACTOR_GROUP_NAME, 'Threat-Actor-Group');
  const groupBis = threatActor(ACTOR_GROUP_BIS_STIX_ID, ACTOR_GROUP_BIS_NAME, 'Threat-Actor-Group');
  const campaign = threat(CAMPAIGN_STIX_ID, CAMPAIGN_NAME, null, 'campaign');

  const creates = [
    created(producer),
    created({ id: PERSONA_STIX_ID, type: 'identity', spec_version: '2.1', name: 'Fixture Persona', identity_class: 'individual' }),
    created(SURVIVOR_OBJECT),
    created(group),
    created(groupBis),
    created(threatActor(ACTOR_INDIVIDUAL_STIX_ID, ACTOR_INDIVIDUAL_NAME, 'Threat-Actor-Individual')),
    created(campaign),
    created(attackPattern(PHISHING_STIX_ID, 'Phishing', PHISHING_MITRE_ID)),
    created(attackPattern(SCRIPTING_STIX_ID, 'Command and Scripting Interpreter', SCRIPTING_MITRE_ID)),
    created(relationship(ACTOR_GROUP_USES_PHISHING_ID, 'uses', ACTOR_GROUP_STIX_ID, PHISHING_STIX_ID)),
    created(relationship(CAMPAIGN_USES_PHISHING_ID, 'uses', CAMPAIGN_STIX_ID, PHISHING_STIX_ID)),
    created(relationship(CAMPAIGN_ATTRIBUTED_TO_SET_ID, 'attributed-to', CAMPAIGN_STIX_ID, SURVIVOR_STIX_ID)),
    created(relationship(CAMPAIGN_ATTRIBUTED_TO_GROUP_BIS_ID, 'attributed-to', CAMPAIGN_STIX_ID, ACTOR_GROUP_BIS_STIX_ID)),
    created(relationship(GROUP_ATTRIBUTED_TO_PERSONA_ID, 'attributed-to', ACTOR_GROUP_STIX_ID, PERSONA_STIX_ID)),
  ];

  const changes = [
    event('update', {
      data: { ...group, description: ACTOR_GROUP_DESCRIPTION },
      context: {
        patch: [{ op: 'replace', path: '/description', value: ACTOR_GROUP_DESCRIPTION }],
        reverse_patch: [{ op: 'replace', path: '/description', value: group['description'] }],
      },
    }),
    created(relationship(CAMPAIGN_USES_SCRIPTING_ID, 'uses', CAMPAIGN_STIX_ID, SCRIPTING_STIX_ID)),
    event('merge', { data: { ...group, description: ACTOR_GROUP_DESCRIPTION }, context: { sources: [groupBis] } }),
  ];

  const renameAndDelete = [
    event('update', {
      data: { ...group, id: RENAMED_ACTOR_STIX_ID, name: RENAMED_ACTOR_NAME },
      context: {
        patch: [
          { op: 'replace', path: '/id', value: RENAMED_ACTOR_STIX_ID },
          { op: 'replace', path: '/name', value: RENAMED_ACTOR_NAME },
        ],
        reverse_patch: [
          { op: 'replace', path: '/id', value: ACTOR_GROUP_STIX_ID },
          { op: 'replace', path: '/name', value: ACTOR_GROUP_NAME },
        ],
      },
    }),
    event('delete', { data: campaign }),
  ];

  return { creates, changes, renameAndDelete };
};
