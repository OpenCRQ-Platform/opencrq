import { describe, expect, it } from 'vitest';
import type { PendingStreamObject } from './pending-batch';
import { planPendingBatch } from './pending-batch';

const at = '2026-01-01 00:00:00.123456+00';

const row = (over: Partial<PendingStreamObject> & { stixId: string, stixType: string }): PendingStreamObject => ({
  sourceRef: null,
  deletedAt: null,
  watermark: at,
  ...over,
});

describe('planPendingBatch', () => {
  it('should name an intrusion set through its own row', () => {
    const plan = planPendingBatch([row({ stixId: 'intrusion-set--a', stixType: 'intrusion-set' })]);

    expect(plan.directGroupStixIds).toEqual(['intrusion-set--a']);
    expect(plan.targetedStixIds).toEqual([]);
    expect(plan.tombstonedGroupStixIds).toEqual([]);
  });

  it('should name a threat actor and a campaign through their own rows, as it does an intrusion set', () => {
    const plan = planPendingBatch([
      row({ stixId: 'threat-actor--a', stixType: 'threat-actor' }),
      row({ stixId: 'campaign--c', stixType: 'campaign' }),
    ]);

    expect(plan.directGroupStixIds).toEqual(['campaign--c', 'threat-actor--a']);
    expect(plan.targetedStixIds).toEqual([]);
  });

  it('should single out a tombstoned campaign as owing a retraction', () => {
    const plan = planPendingBatch([row({ stixId: 'campaign--gone', stixType: 'campaign', deletedAt: new Date() })]);

    expect(plan.tombstonedGroupStixIds).toEqual(['campaign--gone']);
  });

  it('should name the holder of a relationship through its source, without a lookup', () => {
    const plan = planPendingBatch([
      row({ stixId: 'relationship--uses', stixType: 'relationship', sourceRef: 'intrusion-set--a' }),
    ]);

    expect(plan.directGroupStixIds).toEqual(['intrusion-set--a']);
  });

  it('should send a catalog object to the reverse lookup rather than naming a holder', () => {
    const plan = planPendingBatch([
      row({ stixId: 'attack-pattern--t1', stixType: 'attack-pattern' }),
      row({ stixId: 'location--fr', stixType: 'location' }),
      row({ stixId: 'vulnerability--cve', stixType: 'vulnerability' }),
    ]);

    expect(plan.directGroupStixIds).toEqual([]);
    expect(plan.targetedStixIds).toEqual(['attack-pattern--t1', 'location--fr', 'vulnerability--cve']);
  });

  it('should send a report to the reverse lookup, which finds the threats it cites', () => {
    const plan = planPendingBatch([row({ stixId: 'report--r', stixType: 'report' })]);

    expect(plan.directGroupStixIds).toEqual([]);
    expect(plan.targetedStixIds).toEqual(['report--r']);
    expect(plan.producerStixIds).toEqual([]);
  });

  it('should send a malware to the reverse lookup, which finds the threats using it', () => {
    const plan = planPendingBatch([row({ stixId: 'malware--m', stixType: 'malware' })]);

    expect(plan.targetedStixIds).toEqual(['malware--m']);
  });

  /**
   * An identity is both: a sector reached through the relationships targeting it, and a producer
   * reached through `created_by_ref`, which is never a `target_ref`.
   */
  it('should look an identity up on both sides', () => {
    const plan = planPendingBatch([row({ stixId: 'identity--p', stixType: 'identity' })]);

    expect(plan.targetedStixIds).toEqual(['identity--p']);
    expect(plan.producerStixIds).toEqual(['identity--p']);
  });

  it('should single out a tombstoned intrusion set, and it alone, as owing a retraction', () => {
    const plan = planPendingBatch([
      row({ stixId: 'intrusion-set--gone', stixType: 'intrusion-set', deletedAt: new Date() }),
      row({ stixId: 'intrusion-set--live', stixType: 'intrusion-set' }),
      row({ stixId: 'relationship--gone', stixType: 'relationship', sourceRef: 'intrusion-set--live', deletedAt: new Date() }),
    ]);

    expect(plan.tombstonedGroupStixIds).toEqual(['intrusion-set--gone']);
    expect(plan.directGroupStixIds).toEqual(['intrusion-set--gone', 'intrusion-set--live']);
  });

  it('should collapse a burst about one actor onto a single rebuild', () => {
    const burst = Array.from({ length: 40 }, (_, i) => row({
      stixId: `relationship--${i}`,
      stixType: 'relationship',
      sourceRef: 'intrusion-set--a',
    }));

    const plan = planPendingBatch(burst);

    expect(plan.directGroupStixIds).toEqual(['intrusion-set--a']);
    expect(plan.marks).toHaveLength(40);
  });

  it('should carry one mark per row, each with the watermark it was read at', () => {
    const later = '2026-01-02 00:00:00.654321+00';
    const plan = planPendingBatch([
      row({ stixId: 'intrusion-set--a', stixType: 'intrusion-set' }),
      row({ stixId: 'intrusion-set--b', stixType: 'intrusion-set', watermark: later }),
    ]);

    expect(plan.marks).toEqual([
      { stixId: 'intrusion-set--a', watermark: at },
      { stixId: 'intrusion-set--b', watermark: later },
    ]);
  });

  it('should drop a relationship whose source the mirror never denormalized', () => {
    const plan = planPendingBatch([
      row({ stixId: 'relationship--orphan', stixType: 'relationship', sourceRef: null }),
    ]);

    expect(plan.directGroupStixIds).toEqual([]);
    expect(plan.marks).toHaveLength(1);
  });
});
