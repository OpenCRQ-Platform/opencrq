import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

/**
 * Maps `items` in fixed-size chunks, yielding the event loop between chunks so a batch bigger than one chunk cannot starve concurrent IPC/timers on the same process.
 * Throws the reason of `signal` before a chunk once it is aborted.
 */
export const mapInYieldedChunks = async <Item, Mapped>(
  items: Array<Item>,
  chunkSize: number,
  map: (item: Item) => Mapped,
  signal?: AbortSignal,
): Promise<Array<Mapped>> => {
  const mapped: Array<Mapped> = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    signal?.throwIfAborted();
    mapped.push(...items.slice(i, i + chunkSize).map(map));
    await yieldToEventLoop();
  }
  return mapped;
};
