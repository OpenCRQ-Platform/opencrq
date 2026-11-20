import type { ParsedLocation, RouterEvents } from '@tanstack/react-router';

interface NavigationMetadata {
  times: Array<{ type: keyof RouterEvents, start: number }>,
  routerEvent: RouterEvents[keyof RouterEvents],
}

let routerEventsRefs: Array<ParsedLocation> = [];
const routerEventsWeakMap = new WeakMap<ParsedLocation, NavigationMetadata>();

export const navStore = {
  addRouterEvent: (routerEvent: RouterEvents[keyof RouterEvents]) => {
    routerEventsWeakMap.set(routerEvent.toLocation, {
      times: [...routerEventsWeakMap.get(routerEvent.toLocation)?.times ?? [], { type: routerEvent.type, start: performance.now() }],
      routerEvent,
    });
    if (!routerEventsRefs.includes(routerEvent.toLocation)) {
      routerEventsRefs = [...routerEventsRefs, routerEvent.toLocation].slice(-5);
    }
  },
  getLogs: () => ({
    routerEvents: routerEventsRefs.map((ref) => routerEventsWeakMap.get(ref)),
    to: window.location.href,
    date: performance.now(),
  }),
};

export type NavigationLogs = ReturnType<typeof navStore.getLogs>;
