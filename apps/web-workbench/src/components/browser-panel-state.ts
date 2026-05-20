export function shouldShowBrowserHeader(inputs: {
  taskIsTerminal: boolean;
  hasCurrentFrame: boolean;
  hasFinalEvidence: boolean;
  interactiveActive: boolean;
}): boolean {
  if (!inputs.taskIsTerminal) return true;
  return (
    inputs.hasCurrentFrame ||
    inputs.hasFinalEvidence ||
    inputs.interactiveActive
  );
}
