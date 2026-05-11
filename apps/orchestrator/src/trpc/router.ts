import { authRouter } from './routers/auth.js';
import { batchTasksRouter } from './routers/batch-tasks.js';
import { connectionsRouter } from './routers/connections.js';
import { feedbackRouter } from './routers/feedback.js';
import { filesRouter } from './routers/files.js';
import { llmCallsRouter } from './routers/llm-calls.js';
import { memoryRouter } from './routers/memory.js';
import { paymentRouter } from './routers/payment.js';
import { projectsRouter } from './routers/projects.js';
import { quotaRouter } from './routers/quota.js';
import { rolesRouter } from './routers/roles.js';
import { scheduledTasksRouter } from './routers/scheduled-tasks.js';
import { skillsRouter } from './routers/skills.js';
import { tasksRouter } from './routers/tasks.js';
import { usageRouter } from './routers/usage.js';
import { publicProcedure, router } from './trpc.js';

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    time: new Date().toISOString(),
  })),
  auth: authRouter,
  tasks: tasksRouter,
  llmCalls: llmCallsRouter,
  feedback: feedbackRouter,
  memory: memoryRouter,
  payment: paymentRouter,
  projects: projectsRouter,
  quota: quotaRouter,
  roles: rolesRouter,
  skills: skillsRouter,
  files: filesRouter,
  scheduledTasks: scheduledTasksRouter,
  batchTasks: batchTasksRouter,
  connections: connectionsRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
