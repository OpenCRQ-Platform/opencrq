import { describe, expect, it } from 'vitest';
import { mergeMetricsSnapshots } from './metrics-merge';

describe('mergeMetricsSnapshots', () => {
  it('merges two blocks contributing the same family into one HELP/TYPE pair with both processes samples, in input order', () => {
    const pmText = [
      '# HELP opencrq_pm_processes Number of processes',
      '# TYPE opencrq_pm_processes gauge',
      'opencrq_pm_processes{state="RUNNING",process_name="pm"} 3',
      '',
    ].join('\n');
    const workerText = [
      '# HELP opencrq_pm_processes Number of processes',
      '# TYPE opencrq_pm_processes gauge',
      'opencrq_pm_processes{state="RUNNING",process_name="worker"} 1',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'pm', text: pmText },
      { processName: 'worker', text: workerText },
    ]);

    expect(merged.text).toBe([
      '# HELP opencrq_pm_processes Number of processes',
      '# TYPE opencrq_pm_processes gauge',
      'opencrq_pm_processes{state="RUNNING",process_name="pm"} 3',
      'opencrq_pm_processes{state="RUNNING",process_name="worker"} 1',
      '',
    ].join('\n'));
    expect(merged.invalidProcesses).toEqual([]);
    expect(merged.droppedFamilies).toEqual([]);
  });

  it('keeps distinct families with their own metadata and samples, in first-seen order', () => {
    const pmText = [
      '# HELP opencrq_pm_processes Number of processes',
      '# TYPE opencrq_pm_processes gauge',
      'opencrq_pm_processes{state="RUNNING",process_name="pm"} 3',
      '',
    ].join('\n');
    const workerText = [
      '# HELP http_server_request_duration Request duration',
      '# TYPE http_server_request_duration histogram',
      'http_server_request_duration_count{process_name="worker"} 10',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'pm', text: pmText },
      { processName: 'worker', text: workerText },
    ]);

    expect(merged.text).toBe([
      '# HELP opencrq_pm_processes Number of processes',
      '# TYPE opencrq_pm_processes gauge',
      'opencrq_pm_processes{state="RUNNING",process_name="pm"} 3',
      '# HELP http_server_request_duration Request duration',
      '# TYPE http_server_request_duration histogram',
      'http_server_request_duration_count{process_name="worker"} 10',
      '',
    ].join('\n'));
  });

  it('never reorders or alters a family own sample lines', () => {
    const text = [
      '# HELP opencrq_test_total description',
      '# TYPE opencrq_test_total counter',
      'opencrq_test_total{a="1",process_name="pm"} 5',
      'opencrq_test_total{a="2",process_name="pm"} 7',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([{ processName: 'pm', text }]);

    expect(merged.text).toBe(text);
  });

  it('produces output that round-trips as valid input to the same merge (merging two single-process fixtures then re-merging the result)', () => {
    const pmText = [
      '# HELP opencrq_pm_processes Number of processes',
      '# TYPE opencrq_pm_processes gauge',
      'opencrq_pm_processes{state="RUNNING",process_name="pm"} 3',
      '',
    ].join('\n');
    const workerText = [
      '# HELP opencrq_pm_processes Number of processes',
      '# TYPE opencrq_pm_processes gauge',
      'opencrq_pm_processes{state="RUNNING",process_name="worker"} 1',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'pm', text: pmText },
      { processName: 'worker', text: workerText },
    ]);

    const reMerged = mergeMetricsSnapshots([{ processName: 'merged', text: merged.text }]);

    expect(reMerged.text).toBe(merged.text);
  });

  it('returns an empty string for no snapshots', () => {
    expect(mergeMetricsSnapshots([]).text).toBe('');
  });

  it('drops a process contribution whole when one sample line is missing process_name, keeping another valid process', () => {
    const invalidText = [
      '# HELP opencrq_test_total description',
      '# TYPE opencrq_test_total counter',
      'opencrq_test_total{a="1",process_name="broken"} 1',
      'opencrq_test_total{a="2"} 2',
      '',
    ].join('\n');
    const validText = [
      '# HELP http_server_request_duration Request duration',
      '# TYPE http_server_request_duration histogram',
      'http_server_request_duration_count{process_name="worker"} 10',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'broken', text: invalidText },
      { processName: 'worker', text: validText },
    ]);

    expect(merged.invalidProcesses).toEqual(['broken']);
    expect(merged.text).not.toContain('opencrq_test_total');
    expect(merged.text).toContain('http_server_request_duration_count{process_name="worker"} 10');
  });

  it('rejects a block whose sample appears before any directive, instead of discarding the sample and passing the block', () => {
    const orphanText = [
      'opencrq_orphan_total 1',
      '# HELP opencrq_test_total description',
      '# TYPE opencrq_test_total counter',
      'opencrq_test_total{process_name="broken"} 1',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([{ processName: 'broken', text: orphanText }]);

    expect(merged.invalidProcesses).toEqual(['broken']);
    expect(merged.text).toBe('');
  });

  it('reports a contribution carrying no sample line as empty rather than merging it as a success', () => {
    const declarationsOnly = [
      '# HELP opencrq_test_total description',
      '# TYPE opencrq_test_total counter',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'silent', text: declarationsOnly },
      { processName: 'mute', text: '' },
    ]);

    expect(merged.emptyProcesses).toEqual(['silent', 'mute']);
    expect(merged.invalidProcesses).toEqual([]);
    expect(merged.text).toBe('');
  });

  it('drops a family entirely, and reports it, on a TYPE conflict between two processes', () => {
    const firstText = [
      '# HELP opencrq_ambiguous_metric description',
      '# TYPE opencrq_ambiguous_metric counter',
      'opencrq_ambiguous_metric{process_name="a"} 1',
      '',
    ].join('\n');
    const secondText = [
      '# HELP opencrq_ambiguous_metric description',
      '# TYPE opencrq_ambiguous_metric gauge',
      'opencrq_ambiguous_metric{process_name="b"} 2',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'a', text: firstText },
      { processName: 'b', text: secondText },
    ]);

    expect(merged.text).toBe('');
    expect(merged.droppedFamilies).toEqual([{ name: 'opencrq_ambiguous_metric', reason: 'type-conflict' }]);
  });

  it('keeps the first HELP text on a HELP disagreement between two processes', () => {
    const firstText = [
      '# HELP opencrq_shared_total first description',
      '# TYPE opencrq_shared_total counter',
      'opencrq_shared_total{process_name="a"} 1',
      '',
    ].join('\n');
    const secondText = [
      '# HELP opencrq_shared_total second description',
      '# TYPE opencrq_shared_total counter',
      'opencrq_shared_total{process_name="b"} 2',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'a', text: firstText },
      { processName: 'b', text: secondText },
    ]);

    expect(merged.text).toBe([
      '# HELP opencrq_shared_total first description',
      '# TYPE opencrq_shared_total counter',
      'opencrq_shared_total{process_name="a"} 1',
      'opencrq_shared_total{process_name="b"} 2',
      '',
    ].join('\n'));
    expect(merged.metadataConflicts).toEqual([{ name: 'opencrq_shared_total', field: 'help' }]);
  });

  it('backfills HELP/UNIT left undefined by the first-seen block instead of leaving them missing once a later block provides them', () => {
    const firstText = [
      '# TYPE opencrq_shared_total counter',
      'opencrq_shared_total{process_name="a"} 1',
      '',
    ].join('\n');
    const secondText = [
      '# HELP opencrq_shared_total shared description',
      '# TYPE opencrq_shared_total counter',
      '# UNIT opencrq_shared_total seconds',
      'opencrq_shared_total{process_name="b"} 2',
      '',
    ].join('\n');

    const merged = mergeMetricsSnapshots([
      { processName: 'a', text: firstText },
      { processName: 'b', text: secondText },
    ]);

    expect(merged.text).toBe([
      '# HELP opencrq_shared_total shared description',
      '# TYPE opencrq_shared_total counter',
      '# UNIT opencrq_shared_total seconds',
      'opencrq_shared_total{process_name="a"} 1',
      'opencrq_shared_total{process_name="b"} 2',
      '',
    ].join('\n'));
    expect(merged.metadataConflicts).toEqual([]);
  });
});
