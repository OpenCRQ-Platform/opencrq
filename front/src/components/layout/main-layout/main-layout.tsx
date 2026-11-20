import { TanStackDevtools } from '@tanstack/react-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { createContext, useContext } from 'react';
import type { FunctionComponent, PropsWithChildren } from 'react';
import { XtmOneRegistrationToast } from '../../../features/xtm-one';
import { Header } from '../header';
import { FdsNavbar } from './fds-navbar';
import { Page } from './page';

const LayoutContext = createContext(false);

export const useIsInsideLayout = () => useContext(LayoutContext);

export const MainLayout: FunctionComponent<PropsWithChildren> = ({ children }) => (
  <LayoutContext value={true}>
    <div className="flex h-screen">
      <FdsNavbar />
      <div className="flex flex-col flex-grow w-full h-full overflow-auto">
        <Header />
        <XtmOneRegistrationToast />
        <Page>
          {children}
        </Page>
      </div>
      <TanStackDevtools
        config={{
          // eslint-disable-next-line lingui/no-unlocalized-strings
          openHotkey: ['Alt', 'a'],
          triggerHidden: true,
        }}
        plugins={[
          {
            name: 'Tanstack Router',
            render: <TanStackRouterDevtoolsPanel />,
          },
        ]}
      />
    </div>
  </LayoutContext>
);
