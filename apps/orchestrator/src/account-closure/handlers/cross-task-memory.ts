import { createRelationalDeleteHandler, directUserRows } from '../handler-contract.js';

export const crossTaskMemoryClosureHandler = createRelationalDeleteHandler({
  categoryId: 'cross_task_memory',
  targets: [directUserRows('execution_memory'), directUserRows('execution_stats')],
});
