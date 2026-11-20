import { useTheme } from '../../providers';
import logoDark from '/logo-opencrq-dark.svg';
import logoLight from '/logo-opencrq-light.svg';

export const useThemeLogo = () => {
  const { effectiveTheme } = useTheme();
  return effectiveTheme === 'dark' ? logoDark : logoLight;
};
