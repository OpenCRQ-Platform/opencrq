import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes in base64url, which is `JOIN_TOKEN_PATTERN`. */
export const newJoinToken = (): string => randomBytes(32).toString('base64url');

export const hashJoinToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const joinPath = (token: string): string => `/join/${token}`;
