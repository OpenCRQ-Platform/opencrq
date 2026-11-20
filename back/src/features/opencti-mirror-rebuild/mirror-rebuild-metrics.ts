import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('opencrq-opencti-mirror-rebuild');

const actors = meter.createCounter('opencrq.opencti.mirror_rebuild.actors', {
  description: 'Actors a mirror rebuild settled, by outcome. A failed actor leaves the run succeeded, so this is the only place the loss is counted.',
});

export const recordMirrorRebuild = (counts: { rebuilt: number, retracted: number, failed: number }): void => {
  actors.add(counts.rebuilt, { outcome: 'rebuilt' });
  actors.add(counts.retracted, { outcome: 'retracted' });
  actors.add(counts.failed, { outcome: 'failed' });
};
