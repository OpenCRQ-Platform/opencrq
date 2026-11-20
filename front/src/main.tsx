import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@filigran/ui/theme.css';
import './styles.css';
import { App } from './app';
import { loadCatalog, resolveLocale } from './lib';
import { clientReportQueue, onboardingSeenCollection, xtmSessionCollection } from './stores';
import { userPreferenceCollection } from './stores/user-preference-collection';

// Registered unconditionally so reports queued just before navigating away are not lost, even
// when the render guard below short-circuits.
window.addEventListener('pagehide', () => {
  void clientReportQueue.flush({ keepalive: true });
});

const rootElement = document.getElementById('app');
if (rootElement && !rootElement.innerHTML) {
  const root = createRoot(rootElement);
  // The session memory is read synchronously by the login page, and the "Get started seen" marker by the tenant home's
  // `beforeLoad`: loaded before they render.
  // Best effort: an unreadable value must not keep the app from rendering.
  Promise.all([
    userPreferenceCollection.preload(),
    xtmSessionCollection.preload().catch(() => undefined),
    onboardingSeenCollection.preload().catch(() => undefined),
  ])
    .then(() => {
      const pref = userPreferenceCollection.get('user-preference');
      const locale = pref?.locale ?? resolveLocale({ userLocale: null, tenantLocale: null, browserLanguages: navigator.languages });
      return loadCatalog(locale);
    })
    .then(() => {
      root.render(<StrictMode><App /></StrictMode>);
    });
}
