export function followUpTerminalGuardMessage(): string {
  return '只能追问已完成/需复核/失败/取消的任务，正在执行的任务请用回复';
}

export function followUpParentReasonLabel(status: string): string {
  if (status === 'failed') return '失败原因';
  if (status === 'partial_success') return '需复核原因';
  return '终止原因';
}
