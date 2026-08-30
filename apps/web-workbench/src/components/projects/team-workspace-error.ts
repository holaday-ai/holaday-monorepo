export type HiddenWorkspaceErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHORIZED';

/** Classifies only server codes that mean the current team resource is no longer visible. */
export function classifyHiddenWorkspaceError(error: unknown): HiddenWorkspaceErrorCode | null {
  if (!isUnknownRecord(error)) return null;
  const directCode = ownUnknownText(error, 'code');
  if (isHiddenWorkspaceErrorCode(directCode)) return directCode;

  const data = ownUnknownRecord(error, 'data');
  const dataCode = data ? ownUnknownText(data, 'code') : '';
  if (isHiddenWorkspaceErrorCode(dataCode)) return dataCode;

  const shape = ownUnknownRecord(error, 'shape');
  const shapeData = shape ? ownUnknownRecord(shape, 'data') : null;
  const shapeCode = shapeData ? ownUnknownText(shapeData, 'code') : '';
  return isHiddenWorkspaceErrorCode(shapeCode) ? shapeCode : null;
}

function isHiddenWorkspaceErrorCode(value: string): value is HiddenWorkspaceErrorCode {
  return value === 'NOT_FOUND' || value === 'FORBIDDEN' || value === 'UNAUTHORIZED';
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ownUnknownRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const candidate = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : null;
  return isUnknownRecord(candidate) ? candidate : null;
}

function ownUnknownText(value: Record<string, unknown>, key: string): string {
  const candidate = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : null;
  return typeof candidate === 'string' ? candidate : '';
}
