import { customAlphabet } from 'nanoid';

// NanoID alphabet: URL-safe, no lookalikes (we keep full default alphabet for 21-char ids).
const NANOID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const nano21 = customAlphabet(NANOID_ALPHABET, 21);

export const ID_PREFIXES = {
  user: 'usr',
  userProfile: 'prf',
  task: 'tsk',
  taskStep: 'stp',
  taskEvent: 'evt',
  skill: 'skl',
  session: 'sess',
  llmCall: 'llm',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newExternalId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${nano21()}`;
}

export function isExternalId(value: string, kind: IdKind): boolean {
  return (
    value.startsWith(`${ID_PREFIXES[kind]}_`) && value.length === ID_PREFIXES[kind].length + 1 + 21
  );
}
