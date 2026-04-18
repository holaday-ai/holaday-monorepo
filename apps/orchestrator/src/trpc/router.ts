import { authRouter } from './routers/auth.js';
import { tasksRouter } from './routers/tasks.js';
import { publicProcedure, router } from './trpc.js';

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    time: new Date().toISOString(),
  })),
  auth: authRouter,
  tasks: tasksRouter,
});

export type AppRouter = typeof appRouter;
