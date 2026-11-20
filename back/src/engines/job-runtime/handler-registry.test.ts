import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from './handler-registry';

const handler = async () => {};

describe('HandlerRegistry shared slots', () => {
  const registry = () => {
    const built = new HandlerRegistry();
    built.register('simulation', handler, { serialized: true });
    built.register('price', handler, { observed: true, serializedWith: 'simulation' });
    built.register('loose', handler);
    return built;
  };

  it('gives both kinds of a declared slot the same mates, whichever side declared it', () => {
    expect(registry().slotMates('price')).toEqual(['price', 'simulation']);
    expect(registry().slotMates('simulation')).toEqual(['price', 'simulation']);
    expect(registry().slotMates('loose')).toEqual(['loose']);
  });

  it('serializes a kind that only shares a slot', () => {
    const built = new HandlerRegistry();
    built.register('one', handler, { serializedWith: 'two' });
    built.register('two', handler);

    expect(built.listSerializedKinds()).toEqual(['one', 'two']);
    expect(built.listSharedSlots()).toEqual([['one', 'two']]);
  });

  it('leaves a kind without a slot of its own unserialized', () => {
    expect(registry().isSerialized('loose')).toBe(false);
  });
});
