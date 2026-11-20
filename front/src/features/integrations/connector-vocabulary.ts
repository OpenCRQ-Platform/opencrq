import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { ClipboardCheck, Crosshair, Radar, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChipSeverity } from '@filigran/design-system';
import type {
  ConnectorDomain,
  ConnectorMechanism,
  ConnectorScopeKind,
  ConnectorState,
  Schedule,
  ScheduleCadence,
  StreamConnection,
} from '@app/module/client';
import type { StreamAlarm, StreamRelationship, StreamVerdict } from './opencti-stream-filter-utils';
import type { ConnectorBannerSeverity } from './components/connector-banner';
import { formatDateMinute, formatList } from '../../utils';
import { browserTimeZone } from '../../utils/date-utils';
import { formatMinuteOfDay, utcOffsetLabel } from './connector-schedule-utils';

export const scheduleCadenceLabel = (cadence: ScheduleCadence): string => {
  switch (cadence) {
    case 'manual': return t`Manual only`;
    case 'hourly': return t`Every hour`;
    case 'every_6_hours': return t`Every 6 hours`;
    case 'every_12_hours': return t`Every 12 hours`;
    case 'daily': return t`Every day`;
    case 'weekly': return t`Every week`;
  }
};

// 1 January 2023 was a Sunday.
const weekdayName = (weekday: number): string =>
  new Date(2023, 0, 1 + weekday).toLocaleDateString(i18n.locale || 'en', { weekday: 'long' });

/** Monday first, as ISO 8601 orders the week; `value` counts from Sunday, as `Date.getDay` does. */
export const getWeekdayOptions = (): Array<{ value: number, label: string }> => {
  const locale = i18n.locale || 'en';
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    // French writes day names in lower case, which a list item does not take.
    const name = weekdayName(weekday);
    return { value: weekday, label: name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) };
  });
};

/** Read in the schedule's own zone, or the browser's for a cadence that carries none. */
export const formatNextRun = (nextRun: string | Date, schedule: Pick<Schedule, 'timeZone'>): string => {
  const timeZone = schedule.timeZone ?? browserTimeZone();
  const at = formatDateMinute(nextRun, timeZone);
  return timeZone === 'UTC' ? `${at} (UTC)` : `${at} (${timeZone}, ${utcOffsetLabel(timeZone, new Date(nextRun).getTime())})`;
};

export const scheduleSummary = (schedule: Schedule): string => {
  const { atMinute, weekday, timeZone } = schedule;
  if (atMinute === null || timeZone === null) {
    return scheduleCadenceLabel(schedule.cadence);
  }
  const time = formatMinuteOfDay(atMinute);
  if (weekday === null) {
    return t`Every day at ${time} (${timeZone})`;
  }
  const day = weekdayName(weekday);
  return t`Every ${day} at ${time} (${timeZone})`;
};

export const connectorStateLabel = (state: ConnectorState): string => {
  switch (state) {
    case 'unavailable': return t`Unavailable`;
    case 'not_configured': return t`Not configured`;
    case 'never_synced': return t`Never synced`;
    case 'syncing': return t`Syncing`;
    case 'healthy': return t`Healthy`;
    case 'failing': return t`Failing`;
  }
};

/** What the operator does next, read on the chip's tooltip: the reason the vocabulary has six values. */
export const connectorStateNextMove = (state: ConnectorState, enabled = true): string => {
  switch (state) {
    case 'unavailable': return t`Nothing you can do here. Ask an administrator to add the credentials.`;
    case 'not_configured': return t`Bind a service account with Configure.`;
    case 'never_synced': return enabled ? t`Nothing has been imported yet. Press Sync now.` : t`Switched off. Turn it on with Configure.`;
    case 'syncing': return t`A run is under way.`;
    case 'healthy': return t`The last run went through.`;
    case 'failing': return t`Read the errors, then retry.`;
  }
};

/**
 * `not_configured` and `never_synced` share the neutral tone, and never meet: a connector without a
 * service account is only ever on Available, one that has never run only ever on Deployed.
 */
export const CONNECTOR_STATE_SEVERITY: Record<ConnectorState, ChipSeverity> = {
  unavailable: 'high',
  not_configured: 'neutral',
  never_synced: 'neutral',
  syncing: 'info',
  healthy: 'low',
  failing: 'critical',
};

/** The mark a domain carries, the same one on its section header and beside its facet group. */
export const CONNECTOR_DOMAIN_ICON: Record<ConnectorDomain, LucideIcon> = {
  vulnerability: ShieldAlert,
  simulation: Crosshair,
  compliance: ClipboardCheck,
  threat_intelligence: Radar,
};

export const connectorDomainLabel = (domain: ConnectorDomain): string => {
  switch (domain) {
    case 'vulnerability': return t`Vulnerability`;
    case 'simulation': return t`Simulation`;
    case 'compliance': return t`Compliance`;
    case 'threat_intelligence': return t`Threat intelligence`;
  }
};

export const connectorMechanismLabel = (mechanism: ConnectorMechanism): string => {
  switch (mechanism) {
    case 'scheduled_pull': return t`Scheduled pull`;
    case 'live_stream': return t`Live stream`;
  }
};

export const connectorScopeKindLabel = (kind: ConnectorScopeKind): string => {
  switch (kind) {
    case 'cves': return t`CVEs`;
    case 'supporting_assets': return t`Supporting assets`;
    case 'findings': return t`Findings`;
    case 'capability_assessments': return t`Capability assessments`;
    case 'threat_intelligence': return t`Threat intelligence`;
  }
};

export const streamConnectionLabel = (connection: StreamConnection): string => {
  switch (connection) {
    case 'not_configured': return t`Not configured`;
    case 'auth_failed': return t`Authentication failed`;
    case 'disabled': return t`Disabled`;
    case 'not_running': return t`Not running`;
    case 'connected': return t`Connected`;
  }
};

export const STREAM_CONNECTION_SEVERITY: Record<StreamConnection, ChipSeverity> = {
  not_configured: 'neutral',
  auth_failed: 'critical',
  disabled: 'neutral',
  not_running: 'high',
  connected: 'low',
};

const relationshipLabel = (relationship: StreamRelationship): string => {
  switch (relationship) {
    case 'intrusion_set_uses_technique': return t`"uses" from an intrusion set to an attack pattern`;
    case 'intrusion_set_targets_location': return t`"targets" from an intrusion set to a location`;
    case 'intrusion_set_targets_sector': return t`"targets" from an intrusion set to a sector`;
    case 'intrusion_set_targets_vulnerability': return t`"targets" from an intrusion set to a vulnerability`;
    case 'threat_actor_group_uses_technique': return t`"uses" from a threat actor group to an attack pattern`;
    case 'threat_actor_group_targets_location': return t`"targets" from a threat actor group to a location`;
    case 'threat_actor_group_targets_sector': return t`"targets" from a threat actor group to a sector`;
    case 'threat_actor_group_targets_vulnerability': return t`"targets" from a threat actor group to a vulnerability`;
    case 'threat_actor_individual_uses_technique': return t`"uses" from an individual threat actor to an attack pattern`;
    case 'threat_actor_individual_targets_location': return t`"targets" from an individual threat actor to a location`;
    case 'threat_actor_individual_targets_sector': return t`"targets" from an individual threat actor to a sector`;
    case 'threat_actor_individual_targets_vulnerability': return t`"targets" from an individual threat actor to a vulnerability`;
    case 'campaign_uses_technique': return t`"uses" from a campaign to an attack pattern`;
    case 'campaign_targets_location': return t`"targets" from a campaign to a location`;
    case 'campaign_targets_sector': return t`"targets" from a campaign to a sector`;
    case 'campaign_targets_vulnerability': return t`"targets" from a campaign to a vulnerability`;
    case 'attributed_to': return t`"attributed-to" between threats`;
  }
};

const lossLabel = (relationship: StreamRelationship): string => {
  switch (relationship) {
    case 'intrusion_set_uses_technique': return t`no technique of an intrusion set`;
    case 'intrusion_set_targets_location': return t`no country targeted by an intrusion set`;
    case 'intrusion_set_targets_sector': return t`no sector targeted by an intrusion set`;
    case 'intrusion_set_targets_vulnerability': return t`no CVE targeted by an intrusion set`;
    case 'threat_actor_group_uses_technique': return t`no technique of a threat actor group`;
    case 'threat_actor_group_targets_location': return t`no country targeted by a threat actor group`;
    case 'threat_actor_group_targets_sector': return t`no sector targeted by a threat actor group`;
    case 'threat_actor_group_targets_vulnerability': return t`no CVE targeted by a threat actor group`;
    case 'threat_actor_individual_uses_technique': return t`no technique of an individual threat actor`;
    case 'threat_actor_individual_targets_location': return t`no country targeted by an individual threat actor`;
    case 'threat_actor_individual_targets_sector': return t`no sector targeted by an individual threat actor`;
    case 'threat_actor_individual_targets_vulnerability': return t`no CVE targeted by an individual threat actor`;
    case 'campaign_uses_technique': return t`no technique of a campaign`;
    case 'campaign_targets_location': return t`no country targeted by a campaign`;
    case 'campaign_targets_sector': return t`no sector targeted by a campaign`;
    case 'campaign_targets_vulnerability': return t`no CVE targeted by a campaign`;
    case 'attributed_to': return t`no attribution between threats`;
  }
};

const joinClauses = (clauses: Array<string>): string =>
  formatList(clauses);

const listRelationships = (missing: Array<StreamRelationship>): string =>
  joinClauses(missing.map(relationshipLabel));

const listLosses = (missing: Array<StreamRelationship>): string =>
  joinClauses(missing.map(lossLabel));

export const streamVerdictLabel = (verdict: StreamVerdict): string => {
  switch (verdict) {
    case 'delivers': return t`Delivers threat actors`;
    case 'incompatible': return t`Incompatible filter`;
    case 'no_actors': return t`No threat actors`;
    case 'stopped': return t`Stopped in OpenCTI`;
    case 'undecidable': return t`Cannot be judged`;
  }
};

/** What the stream will and will not deliver, in the operator's terms rather than the API's. */
export const streamVerdictExplanation = (verdict: StreamVerdict, missing: Array<StreamRelationship> = []): string => {
  switch (verdict) {
    case 'delivers':
      return t`This filter admits threat actors. The sectors, countries and CVEs they target, and the techniques they use, arrive with them.`;
    case 'incompatible': {
      const relationships = listRelationships(missing);
      const losses = listLosses(missing);
      return t`This filter does not admit everything the connector reads. It leaves out ${relationships}, so ${losses} would arrive.`;
    }
    case 'no_actors':
      return t`This filter admits no threat actor, so no targeted sector, no country, no CVE and no technique would arrive either.`;
    case 'stopped':
      return t`This stream is stopped in OpenCTI. It refuses connections until someone restarts it there.`;
    case 'undecidable':
      return t`This filter uses conditions this platform does not evaluate, so it cannot say whether the stream carries threat actors. Read the filter and decide.`;
  }
};

/** Grey for what cannot be judged: a verdict that guesses is worse than one that abstains. */
export const STREAM_VERDICT_SEVERITY: Record<StreamVerdict, ChipSeverity> = {
  delivers: 'low',
  incompatible: 'critical',
  no_actors: 'critical',
  stopped: 'critical',
  undecidable: 'neutral',
};

export const streamAlarmTitle = (alarm: StreamAlarm): string => {
  switch (alarm) {
    case 'incompatible': return t`This stream cannot supply the connector`;
    case 'no_actors': return t`This stream carries no threat actor`;
    case 'stopped': return t`This stream is stopped in OpenCTI`;
    case 'no_history': return t`This stream replays no history`;
    case 'missing': return t`This Live Stream no longer exists in OpenCTI`;
  }
};

export const streamAlarmDetail = (alarm: StreamAlarm, missing: Array<StreamRelationship> = []): string => {
  switch (alarm) {
    case 'incompatible': {
      const relationships = listRelationships(missing);
      const losses = listLosses(missing);
      return t`Its filter leaves out ${relationships}, so ${losses} will arrive. Widen it in OpenCTI to admit them.`;
    }
    case 'no_actors':
      return t`Its filter admits none, so no targeted sector, no country, no CVE and no technique will arrive. Choose another Live Stream, or widen this one in OpenCTI.`;
    case 'stopped':
      return t`It refuses connections until someone restarts it in OpenCTI, so nothing this connector does can take effect.`;
    case 'no_history':
      return t`Only what OpenCTI publishes from now on will arrive, and the threat actors already in it will not.`;
    case 'missing':
      return t`The stream this connector is bound to is not among those the deployment's token can see, so nothing will arrive until another one is chosen.`;
  }
};

/** A stopped, starved or vanished stream imports nothing at all; a missing replay still lets live events through. */
export const STREAM_ALARM_SEVERITY: Record<StreamAlarm, ConnectorBannerSeverity> = {
  incompatible: 'error',
  no_actors: 'error',
  stopped: 'error',
  missing: 'error',
  no_history: 'warning',
};

export const streamFilterKeyLabel = (key: string): string => {
  switch (key) {
    case 'entity_type': return t`Entity type`;
    case 'fromTypes': return t`From type`;
    case 'toTypes': return t`To type`;
    case 'fromId': return t`From`;
    case 'toId': return t`To`;
    case 'objectMarking': return t`Marking`;
    case 'objectLabel': return t`Label`;
    case 'createdBy': return t`Author`;
    case 'confidence': return t`Confidence`;
    case 'created_at': return t`Created`;
    case 'workflow_id': return t`Status`;
    default: return key;
  }
};

export const streamFilterOperatorLabel = (operator: string): string => {
  switch (operator) {
    case 'eq': return t`is one of`;
    case 'not_eq': return t`is none of`;
    case 'nil': return t`is empty`;
    case 'not_nil': return t`is set`;
    case 'gt': return t`is more than`;
    case 'gte': return t`is at least`;
    case 'lt': return t`is less than`;
    case 'lte': return t`is at most`;
    case 'starts_with': return t`starts with`;
    case 'contains': return t`contains`;
    case 'search': return t`matches`;
    default: return operator;
  }
};
