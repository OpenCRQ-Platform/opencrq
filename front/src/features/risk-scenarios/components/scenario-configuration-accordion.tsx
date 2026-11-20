import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import type { MissingDataItem } from './use-missing-data-items';
import { MISSING_DATA_ACTION_CLASS, MissingDataAccordion } from '../../../components/shared';

interface ScenarioConfigurationAccordionProps {
  items: Array<MissingDataItem>,
}

/**
 * Scenario-scoped skin over {@link MissingDataAccordion}. It owns the `<Link>` because the
 * action's `from`/`to` are typed against the risk-scenario route, which supplies the params
 * implicitly: this component only renders inside that route.
 */
export const ScenarioConfigurationAccordion: FunctionComponent<ScenarioConfigurationAccordionProps> = ({ items }) => (
  <MissingDataAccordion
    title={<Trans>Scenario Configuration</Trans>}
    items={items.map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      action: item.action && (
        <Link from={item.action.from} to={item.action.to} className={MISSING_DATA_ACTION_CLASS}>
          {item.action.text}
        </Link>
      ),
    }))}
  />
);
