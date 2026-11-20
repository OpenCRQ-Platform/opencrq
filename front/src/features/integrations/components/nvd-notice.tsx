import type { FunctionComponent } from 'react';

/**
 * The NVD API terms of use give this sentence verbatim and ask for it "prominently within the
 * application" (https://nvd.nist.gov/developers/terms-of-use). It is shown in English whatever the
 * language, so it stays out of the translation catalogue.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- official wording the NVD terms require verbatim, never translated
export const NVD_NOTICE = 'This product uses the NVD API but is not endorsed or certified by the NVD.';

/** Set like the connector description beside it, as the terms ask for it prominently; never translated, so marked English for screen readers. */
export const NvdNotice: FunctionComponent = () => <p lang="en">{NVD_NOTICE}</p>;
