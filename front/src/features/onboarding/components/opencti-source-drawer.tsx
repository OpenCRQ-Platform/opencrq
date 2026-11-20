import { Button, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DisplayDrawer } from '../../../components/shared';
import { Loader } from '../../../components/ui/loader';
import { useHasManageSecurity } from '../../../hooks/utils/use-has-manage-security';
import { useTRPC } from '../../../lib';
import {
  getConnectors,
  OpenctiConfigureFields,
  OpenctiEnabledSwitch,
  useOpenctiConfigure,
} from '../../integrations';
import { getConnectorCardMode, OPENCTI_DOCUMENTATION_URL, openctiEnvBlock } from '../onboarding-utils';
import { ConnectorUnavailableBody } from './connector-unavailable-body';

const SOURCE = 'opencti';

const ConfigureForm: FunctionComponent<{ onSaved: () => void }> = ({ onSaved }) => {
  const configure = useOpenctiConfigure({ onSaved });

  if (configure.isStreamsError) {
    return (
      <Text as="p" variant="content-compact" className="text-default-secondary">
        {t`Unable to load Live Streams from OpenCTI right now. It may be temporarily unavailable, so try again shortly.`}
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <OpenctiEnabledSwitch configure={configure} />
      <form noValidate onSubmit={configure.form.handleSubmit(configure.submit)} className="flex flex-col gap-4">
        <OpenctiConfigureFields configure={configure} />
        <div className="flex justify-end">
          <Button type="submit" priority="secondary" disabled={configure.isPending}>{t`Save`}</Button>
        </div>
      </form>
    </div>
  );
};

const IntegrationsLink: FunctionComponent = () => {
  const { linkOption } = getConnectors()[SOURCE];

  return (
    <div className="flex items-center border-t border-[var(--fds-border-elevation-subtle)] pt-4">
      <Link {...linkOption} className="ml-auto text-primary underline-offset-4 hover:underline">
        <Text as="span" variant="content-compact">{t`Follow in Integrations`}</Text>
      </Link>
    </div>
  );
};

const ReadonlyBody: FunctionComponent = () => (
  <Text as="p" variant="content-compact" className="text-default-secondary">
    {t`An administrator configures this connector.`}
  </Text>
);

const OpenctiSourceBody: FunctionComponent<{ tenantId: string, onSaved: () => void }> = ({ tenantId, onSaved }) => {
  const trpc = useTRPC();
  const { data: connector } = useQuery(trpc.connectors.getConnector.queryOptions({ source: SOURCE }));
  const hasManageSecurity = useHasManageSecurity();

  if (connector === undefined) {
    return <Loader />;
  }

  const mode = getConnectorCardMode({ platformConfigured: connector.platformConfigured, hasManageSecurity });

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {mode === 'unavailable' && (
        <ConnectorUnavailableBody
          message={t`A platform administrator enables OpenCTI for this tenant: set the variables below in the platform's environment, then restart the platform.`}
          envBlock={openctiEnvBlock(tenantId)}
          documentationUrl={OPENCTI_DOCUMENTATION_URL}
        />
      )}
      {mode === 'configure' && (
        <>
          <Suspense fallback={<Loader />}>
            <ConfigureForm onSaved={onSaved} />
          </Suspense>
          <IntegrationsLink />
        </>
      )}
      {mode === 'readonly' && <ReadonlyBody />}
    </div>
  );
};

interface OpenctiSourceDrawerProps {
  tenantId: string,
  open: boolean,
  onClose: () => void,
}

export const OpenctiSourceDrawer: FunctionComponent<OpenctiSourceDrawerProps> = ({ tenantId, open, onClose }) => (
  <DisplayDrawer open={open} onClose={onClose} title={getConnectors()[SOURCE].name}>
    <OpenctiSourceBody tenantId={tenantId} onSaved={onClose} />
  </DisplayDrawer>
);
