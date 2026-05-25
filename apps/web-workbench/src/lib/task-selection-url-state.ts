export function shouldKeepProjectFilterForPickedTask(options: {
  readonly currentProjectId: string | null;
  readonly taskProjectId: string | null | undefined;
}): boolean {
  if (!options.currentProjectId) return true;
  return options.taskProjectId === options.currentProjectId;
}

