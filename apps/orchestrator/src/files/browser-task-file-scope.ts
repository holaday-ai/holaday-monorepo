import { eq } from 'drizzle-orm';
import {
  BrowserTaskFiles,
  type ValidatedBrowserTaskFile,
} from '../agent/browser-tools/browser-task-files.js';
import type { DB } from '../db/client.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import type { FileService } from './file-service.js';

export function createBrowserTaskFileScope(options: {
  db: DB;
  files: FileService;
  taskId: string;
  userId: number;
  origin: string;
  inputs: readonly ValidatedBrowserTaskFile[];
}) {
  const scope = new BrowserTaskFiles({
    taskId: options.taskId,
    userId: options.userId,
    files: options.files,
    active: async () => {
      const [owner] = await options.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, options.userId))
        .limit(1);
      if (owner?.status !== 'active') return false;
      const [task] = await options.db
        .select({ userId: tasks.userId, status: tasks.status, origin: tasks.origin })
        .from(tasks)
        .where(eq(tasks.externalId, options.taskId))
        .limit(1);
      return (
        task?.userId === options.userId &&
        task.origin === options.origin &&
        ['executing', 'awaiting_user'].includes(task.status)
      );
    },
  });
  scope.admitReferences(options.inputs);
  return scope;
}
