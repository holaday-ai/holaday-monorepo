import type { EvolutionConfig } from './evolution-config.js';

/**
 * Batch 06 — BullMQ background scheduling of the self-evolution loop.
 *
 * One queue (`playbook-evolution`), one worker (concurrency 1), up to three
 * repeatable job schedulers: `sediment`, `canary`, `explore`. Each scheduler
 * exists only while its env switch is on; switching one off removes its
 * scheduler on the next boot. With every switch off (the default) `start()`
 * returns without opening any Redis connection.
 *
 * BullMQ is injected through `factories` so the scheduling logic is unit
 * tested without Redis; production uses `createBullmqFactories(redisUrl)`.
 */

export const PLAYBOOK_EVOLUTION_QUEUE = 'playbook-evolution';
export const EVOLUTION_JOB_NAMES = ['sediment', 'canary', 'explore'] as const;
export type EvolutionJobName = (typeof EVOLUTION_JOB_NAMES)[number];

export type EvolutionJobHandlers = Record<EvolutionJobName, () => Promise<unknown>>;

export interface PlannedJob {
  name: EvolutionJobName;
  everyMs: number;
}

export function plannedEvolutionJobs(config: EvolutionConfig): PlannedJob[] {
  const jobs: PlannedJob[] = [];
  if (config.sedimentEnabled) jobs.push({ name: 'sediment', everyMs: config.sedimentIntervalMs });
  if (config.canaryEnabled) jobs.push({ name: 'canary', everyMs: config.canaryIntervalMs });
  if (config.explorerScheduleEnabled)
    jobs.push({ name: 'explore', everyMs: config.explorerIntervalMs });
  return jobs;
}

/** The slice of BullMQ's Queue the scheduler uses. */
export interface EvolutionQueuePort {
  upsertJobScheduler(
    id: string,
    repeat: { every: number },
    template: { name: string; data: Record<string, never>; opts?: Record<string, unknown> },
  ): Promise<unknown>;
  removeJobScheduler(id: string): Promise<unknown>;
  close(): Promise<void>;
}

/** The slice of BullMQ's Worker the scheduler uses. */
export interface EvolutionWorkerPort {
  close(): Promise<void>;
}

export interface EvolutionSchedulerFactories {
  createQueue(name: string): EvolutionQueuePort;
  createWorker(
    name: string,
    processor: (job: { name: string }) => Promise<unknown>,
  ): EvolutionWorkerPort;
  /** Release shared connections after queue + worker are closed. */
  dispose?(): Promise<void>;
}

interface SchedulerLogger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}

export interface EvolutionScheduler {
  readonly jobs: readonly PlannedJob[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createEvolutionScheduler(input: {
  config: EvolutionConfig;
  handlers: EvolutionJobHandlers;
  factories: () => EvolutionSchedulerFactories | Promise<EvolutionSchedulerFactories>;
  logger?: SchedulerLogger;
}): EvolutionScheduler {
  const jobs = plannedEvolutionJobs(input.config);
  let queue: EvolutionQueuePort | undefined;
  let worker: EvolutionWorkerPort | undefined;
  let factories: EvolutionSchedulerFactories | undefined;

  const processor = async (job: { name: string }) => {
    if (!jobs.some((j) => j.name === job.name)) {
      input.logger?.warn({ job: job.name }, 'playbook evolution: job not enabled, skipped');
      return null;
    }
    const handler = input.handlers[job.name as EvolutionJobName];
    try {
      const result = await handler();
      input.logger?.info({ job: job.name }, 'playbook evolution: job done');
      return result ?? null;
    } catch (err) {
      input.logger?.warn(
        { job: job.name, err: err instanceof Error ? err.message : String(err) },
        'playbook evolution: job failed (non-fatal)',
      );
      throw err;
    }
  };

  return {
    jobs,
    async start() {
      if (jobs.length === 0) return; // all switches off: no Redis, no worker
      factories = await input.factories();
      queue = factories.createQueue(PLAYBOOK_EVOLUTION_QUEUE);
      for (const name of EVOLUTION_JOB_NAMES) {
        const planned = jobs.find((j) => j.name === name);
        if (planned) {
          await queue.upsertJobScheduler(
            `playbook-evolution:${name}`,
            { every: planned.everyMs },
            { name, data: {}, opts: { removeOnComplete: 50, removeOnFail: 50 } },
          );
        } else {
          await queue.removeJobScheduler(`playbook-evolution:${name}`);
        }
      }
      worker = factories.createWorker(PLAYBOOK_EVOLUTION_QUEUE, processor);
      input.logger?.info({ jobs }, 'playbook evolution: scheduler started');
    },
    async stop() {
      await worker?.close();
      await queue?.close();
      await factories?.dispose?.();
      worker = undefined;
      queue = undefined;
      factories = undefined;
    },
  };
}

/** Production BullMQ binding (lazy import so an all-off boot never loads bullmq). */
export async function createBullmqFactories(
  redisUrl: string,
): Promise<EvolutionSchedulerFactories> {
  const [{ Queue, Worker }, { Redis }] = await Promise.all([import('bullmq'), import('ioredis')]);
  // Workers need blocking connections without a per-request retry cap.
  const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  return {
    createQueue: (name) =>
      new Queue(name, { connection: queueConnection }) as unknown as EvolutionQueuePort,
    createWorker: (name, processor) =>
      new Worker(name, async (job) => processor({ name: job.name }), {
        connection: workerConnection,
        concurrency: 1,
      }) as unknown as EvolutionWorkerPort,
    async dispose() {
      queueConnection.disconnect();
      workerConnection.disconnect();
    },
  };
}
