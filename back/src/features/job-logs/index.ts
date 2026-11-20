import { createServices, JOB_LOGS_TABLE, jobLogsService, STREAM_LOG_SCOPE_KIND } from '@app/module';
import { config } from '../../config';
import { STREAM_LOG_RETENTION_LINES } from '../../config-schema';
import { dbEngine } from '../../engines/db';
import { notifyDataChanged } from '../../utils/data-changed-notify';
import { captureLine, installLogCapture, uninstallLogCapture } from '../../utils/log-capture';
import { setLogSink } from '../../utils/logger';
import { registerFeature } from '../features-manager';

registerFeature({
  key: 'job-logs',
  activate: (signal) => {
    // A system origin with the scope's tenant stated: under the connector's own origin the lines
    // would be dropped while its service account is inactive, which is a state this tab explains.
    const { jobLogs } = createServices([jobLogsService], dbEngine.db).withOrigin({ type: 'system' });

    installLogCapture(async (lines) => {
      await jobLogs.appendLines(lines);
      const streamTenants = new Set(lines
        .filter((line) => line.scopeKind === STREAM_LOG_SCOPE_KIND)
        .map((line) => line.tenantId));
      const keepLines = config().jobs?.log_retention_lines ?? STREAM_LOG_RETENTION_LINES;
      await Promise.all([...streamTenants].map(
        (tenantId) => jobLogs.trimToLineCount(tenantId, STREAM_LOG_SCOPE_KIND, keepLines),
      ));
      // The table carries no `data_changed` trigger, a doorbell per line being a full cache
      // invalidation per line in every open browser.
      const tenants = new Set(lines.map((line) => line.tenantId));
      await Promise.all([...tenants].map((tenantId) => notifyDataChanged(dbEngine.pool, tenantId, JOB_LOGS_TABLE)));
    });

    setLogSink(captureLine);

    signal.addEventListener('abort', () => {
      setLogSink(null);
      uninstallLogCapture();
    }, { once: true });
  },
});
