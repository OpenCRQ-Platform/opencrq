import { TanStackDevtools } from '@tanstack/react-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { createContext, useContext } from 'react';
import type { FunctionComponent, PropsWithChildren } from 'react';
import { AskArianeLayoutProvider, useAskArianeContentPush, XtmOneRegistrationToast } from '../../../features/xtm-one';
import { cn } from '../../../utils';
import { Header } from '../header';
import { FdsNavbar } from './fds-navbar';
import { Page } from './page';

const LayoutContext = createContext(false);

export const useIsInsideLayout = () => useContext(LayoutContext);

/**
 * The page, pushed from the right by the docked Ask Ariane panel rather than
 * covered by it, as in OpenCTI and OpenAEV: it narrows to the width the panel
 * leaves, so tables, charts and drawers reflow. The header keeps the full
 * width and the panel docks under it, as there.
 */
const PushedByAskAriane: FunctionComponent<PropsWithChildren> = ({ children }) => {
  const { marginRight, animate } = useAskArianeContentPush();
  return (
    <div
      data-testid="ask-ariane-pushed-area"
      className={cn(
        'flex flex-col flex-1 min-h-0 min-w-0',
        animate && 'transition-[margin-right] duration-200 ease-in-out motion-reduce:transition-none',
      )}
      style={{ marginRight }}
    >
      {children}
    </div>
  );
};

export const MainLayout: FunctionComponent<PropsWithChildren> = ({ children }) => (
  <LayoutContext value={true}>
    <AskArianeLayoutProvider>
      <div className="flex h-screen">
        <FdsNavbar />
        <div className="flex flex-col flex-grow w-full min-w-0 h-full overflow-auto">
          <Header />
          <XtmOneRegistrationToast />
          <PushedByAskAriane>
            <Page>
              {children}
            </Page>
          </PushedByAskAriane>
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
    </AskArianeLayoutProvider>
  </LayoutContext>
);
