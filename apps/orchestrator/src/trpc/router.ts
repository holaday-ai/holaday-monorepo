import { accountClosureRouter } from './routers/account-closure.js';
import { adminRouter } from './routers/admin.js';
import { apiKeysRouter } from './routers/api-keys.js';
import { astrologyRouter } from './routers/astrology.js';
import { authRouter } from './routers/auth.js';
import { batchTasksRouter } from './routers/batch-tasks.js';
import { connectionsRouter } from './routers/connections.js';
import { energyRouter } from './routers/energy.js';
import { feedbackRouter } from './routers/feedback.js';
import { filesRouter } from './routers/files.js';
import { llmCallsRouter } from './routers/llm-calls.js';
import { memoryRouter } from './routers/memory.js';
import { notificationChannelsRouter, notificationsRouter } from './routers/notifications.js';
import { partnerRouter } from './routers/partner.js';
import { paymentRouter } from './routers/payment.js';
import { plannedTasksRouter } from './routers/planned-tasks.js';
import { projectsRouter } from './routers/projects.js';
import { quotaRouter } from './routers/quota.js';
import { rolesRouter } from './routers/roles.js';
import { scheduledTasksRouter } from './routers/scheduled-tasks.js';
import { skillsRouter } from './routers/skills.js';
import { stocksRouter } from './routers/stocks.js';
import { tasksRouter } from './routers/tasks.js';
import { usageRouter } from './routers/usage.js';
import { videoEditingRouter } from './routers/video-editing.js';
import { videoOnboardingRouter } from './routers/video-onboarding.js';
import { watchlistsRouter } from './routers/watchlists.js';
import { publicProcedure, router } from './trpc.js';

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    time: new Date().toISOString(),
  })),
  accountClosure: accountClosureRouter,
  astrology: astrologyRouter,
  energy: energyRouter,
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
  stocks: stocksRouter,
  files: filesRouter,
  scheduledTasks: scheduledTasksRouter,
  batchTasks: batchTasksRouter,
  plannedTasks: plannedTasksRouter,
  apiKeys: apiKeysRouter,
  connections: connectionsRouter,
  usage: usageRouter,
  notifications: notificationsRouter,
  notificationChannels: notificationChannelsRouter,
  partner: partnerRouter,
  admin: adminRouter,
  watchlists: watchlistsRouter,
  videoOnboarding: videoOnboardingRouter,
  videoEditing: videoEditingRouter,
});

export type AppRouter = typeof appRouter;
