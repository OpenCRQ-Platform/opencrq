const isStorage = (value: unknown): value is Storage =>
  typeof value === 'object'
  && value !== null
  && 'getItem' in value
  && typeof value.getItem === 'function';

const readProperty = (source: unknown, key: string): unknown =>
  (typeof source === 'object' && source !== null ? Reflect.get(source, key) : undefined);

const jsdomWindow = readProperty(Reflect.get(globalThis, 'jsdom'), 'window');

for (const key of ['localStorage', 'sessionStorage'] as const) {
  const jsdomStorage = readProperty(jsdomWindow, key);

  if (!isStorage(Reflect.get(globalThis, key)) && isStorage(jsdomStorage)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => jsdomStorage,
    });
  }
}
