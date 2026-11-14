/** REBUILD-3: the answer contracts there are (only price so far). */
export type AnswerContractKind = 'price';

/**
 * Tasks whose answer the price contract delivered. Downstream checks that the contract
 * replaces (the ecommerce row check over the answer text) skip them. Cleared with the task's
 * execution state.
 */
const handled = new Map<string, AnswerContractKind>();

export function markAnswerContract(taskId: string, kind: AnswerContractKind): void {
  if (taskId) handled.set(taskId, kind);
}

export function answerContractOf(taskId: string): AnswerContractKind | undefined {
  return handled.get(taskId);
}

export function clearAnswerContract(taskId: string): void {
  handled.delete(taskId);
}
