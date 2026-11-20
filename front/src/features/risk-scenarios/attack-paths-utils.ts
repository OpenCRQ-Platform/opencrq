import { ATTACK_PATH_KEYS } from '@app/module/client';

export type AttackPathKey = typeof ATTACK_PATH_KEYS[number];

const isAttackPathKey = (key: string): key is AttackPathKey => (ATTACK_PATH_KEYS as ReadonlyArray<string>).includes(key);

/** A run names the walk's obstacles and the attack paths it cannot play by the same keys: this tells them apart, order kept. */
export const splitUnplayableObstacles = (keys: ReadonlyArray<string>): { walk: Array<string>, paths: Array<AttackPathKey> } => ({
  walk: keys.filter((key) => !isAttackPathKey(key)),
  paths: keys.filter(isAttackPathKey),
});
