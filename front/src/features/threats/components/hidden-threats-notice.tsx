import { Alert } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';

/** Shown while OpenCTI has not said what the reader may read there (`readerScopeUnresolved`). */
export const HiddenThreatsNotice: FunctionComponent = () => (
  <Alert
    elevation={1}
    severity="warning"
    title={t`Some threats may be hidden from you.`}
    description={t`OpenCRQ could not read what you are allowed to see in OpenCTI, so it shows threats from OpenCTI only when they carry no marking and no sharing restriction. Ask an administrator to check that OpenCTI is reachable, that your OpenCTI account exists and that OpenCTI accepts sign-in from this platform.`}
  />
);
