import type { DrainMode } from './execution-drain.js';

export interface DrainStateIdentity {
  epoch: string;
  candidate: string;
  bootId: string;
}
export interface DrainStateRecord extends DrainStateIdentity {
  schemaVersion: 1;
  sequence: number;
  mode: DrainMode;
  dirty: boolean;
}

export function checkedDrainIdentity(value: DrainStateIdentity): Readonly<DrainStateIdentity> {
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'bootId,candidate,epoch' ||
    typeof value.epoch !== 'string' ||
    !/^[a-f0-9]{16,48}$/.test(value.epoch) ||
    typeof value.candidate !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.candidate) ||
    typeof value.bootId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.bootId)
  )
    throw new Error('DRAIN_STATE_UNAVAILABLE');
  return Object.freeze({ epoch: value.epoch, candidate: value.candidate, bootId: value.bootId });
}

export function encodeDrainState(value: DrainStateRecord): string {
  const identity = checkedDrainIdentity({
    epoch: value.epoch,
    candidate: value.candidate,
    bootId: value.bootId,
  });
  if (
    Object.keys(value).sort().join(',') !==
      'bootId,candidate,dirty,epoch,mode,schemaVersion,sequence' ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !['closed', 'open', 'blocked'].includes(value.mode) ||
    typeof value.dirty !== 'boolean'
  )
    throw new Error('DRAIN_STATE_UNAVAILABLE');
  return `${JSON.stringify({
    schemaVersion: 1,
    ...identity,
    sequence: value.sequence,
    mode: value.mode,
    dirty: value.dirty,
  })}\n`;
}

export function decodeDrainState(bytes: string): Readonly<DrainStateRecord> {
  const parsed: DrainStateRecord = JSON.parse(bytes);
  // Canonical bytes reject duplicate keys, unexpected properties and ambiguity.
  if (encodeDrainState(parsed) !== bytes) throw new Error('DRAIN_STATE_UNAVAILABLE');
  return Object.freeze(parsed);
}
