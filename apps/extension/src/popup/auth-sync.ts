export function shouldClearRejectedPopupToken(
  currentToken: string | null,
  rejectedToken: string,
): boolean {
  return currentToken === rejectedToken;
}
