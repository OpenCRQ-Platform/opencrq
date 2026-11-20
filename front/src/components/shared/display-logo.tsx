import { t } from '@lingui/core/macro';
import { useThemeLogo } from '../../hooks';

export const DisplayLogo = () => {
  const logo = useThemeLogo();

  return <img src={logo} alt={t`OpenCRQ Logo`} />;
};
