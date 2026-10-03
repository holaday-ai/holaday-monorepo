import { type DrainStateIdentity, checkedDrainIdentity } from './drain-state-record.js';

export interface DrainCommand extends DrainStateIdentity {
  protocol: 1;
  op: 'status' | 'close' | 'open';
  version: number;
  serial: number;
  expiresAt: number;
}

export function decodeDrainCommand(bytes: Buffer): Readonly<DrainCommand> {
  const invalid = () => new Error('INVALID_COMMAND');
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > 1536) throw invalid();
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw invalid();
  const value = JSON.parse(text) as DrainCommand;
  if (
    !value ||
    Object.keys(value).sort().join(',') !==
      'bootId,candidate,epoch,expiresAt,op,protocol,serial,version'
  )
    throw invalid();
  const identity = checkedDrainIdentity({
    epoch: value.epoch,
    candidate: value.candidate,
    bootId: value.bootId,
  });
  if (
    value.protocol !== 1 ||
    !['status', 'close', 'open'].includes(value.op) ||
    ![value.version, value.serial, value.expiresAt].every((n) => Number.isSafeInteger(n) && n > 0)
  )
    throw invalid();
  const command: DrainCommand = {
    protocol: 1,
    op: value.op,
    ...identity,
    version: value.version,
    serial: value.serial,
    expiresAt: value.expiresAt,
  };
  if (`${JSON.stringify(command)}\n` !== text) throw invalid();
  return Object.freeze(command);
}
