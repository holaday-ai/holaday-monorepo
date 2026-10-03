import { describe, expect, it, vi } from 'vitest';
import { readEvolutionConfig } from './evolution-config.js';
import {
  type EvolutionSchedulerFactories,
  createEvolutionScheduler,
  plannedEvolutionJobs,
} from './evolution-scheduler.js';
import { EXPLORER_SCHEDULED_SITES } from './explorer-sites.js';

function fakeFactories() {
  const calls: string[] = [];
  let processor: ((job: { name: string }) => Promise<unknown>) | undefined;
  const factories: EvolutionSchedulerFactories = {
    createQueue: (name) => {
      calls.push(`queue:${name}`);
      return {
        upsertJobScheduler: async (id, repeat) => {
          calls.push(`upsert:${id}:${repeat.every}`);
        },
        removeJobScheduler: async (id) => {
          calls.push(`remove:${id}`);
        },
        close: async () => {
          calls.push('queue:close');
        },
      };
    },
    createWorker: (name, p) => {
      processor = p;
      calls.push(`worker:${name}`);
      return {
        close: async () => {
          calls.push('worker:close');
        },
      };
    },
  };
  return { factories, calls, run: (name: string) => processor?.({ name }) };
}

describe('playbook evolution scheduler (BullMQ)', () => {
  it('is entirely off by default and the explorer site list starts empty', () => {
    const config = readEvolutionConfig({});
    expect(config).toMatchObject({
      sedimentEnabled: false,
      canaryEnabled: false,
      reuseEnabled: false,
      explorerScheduleEnabled: false,
      canaryPassThreshold: 3,
      sedimentMinSupport: 2,
    });
    expect(plannedEvolutionJobs(config)).toEqual([]);
    expect(EXPLORER_SCHEDULED_SITES).toEqual([]);
  });

  it('opens no queue/worker (no Redis) when every switch is off', async () => {
    const factory = vi.fn();
    const scheduler = createEvolutionScheduler({
      config: readEvolutionConfig({}),
      handlers: { sediment: vi.fn(), canary: vi.fn(), explore: vi.fn() },
      factories: factory,
    });
    await scheduler.start();
    await scheduler.stop();
    expect(factory).not.toHaveBeenCalled();
  });

  it('upserts enabled job schedulers, removes disabled ones, and dispatches jobs by name', async () => {
    const { factories, calls, run } = fakeFactories();
    const handlers = {
      sediment: vi.fn(async () => 'sedimented'),
      canary: vi.fn(async () => 'canaried'),
      explore: vi.fn(async () => 'explored'),
    };
    const scheduler = createEvolutionScheduler({
      config: readEvolutionConfig({
        PLAYBOOK_SEDIMENT_ENABLED: 'true',
        PLAYBOOK_CANARY_ENABLED: 'true',
        PLAYBOOK_CANARY_INTERVAL_MS: '600000',
      }),
      handlers,
      factories: () => factories,
    });
    await scheduler.start();
    expect(calls).toEqual([
      'queue:playbook-evolution',
      'upsert:playbook-evolution:sediment:21600000',
      'upsert:playbook-evolution:canary:600000',
      'remove:playbook-evolution:explore',
      'worker:playbook-evolution',
    ]);
    await expect(run('canary')).resolves.toBe('canaried');
    await expect(run('explore')).resolves.toBeNull(); // not enabled → skipped
    expect(handlers.explore).not.toHaveBeenCalled();
    await scheduler.stop();
    expect(calls.slice(-2)).toEqual(['worker:close', 'queue:close']);
  });

  it('rejects out-of-range thresholds back to safe defaults', () => {
    const config = readEvolutionConfig({
      PLAYBOOK_CANARY_PASS_THRESHOLD: '0',
      PLAYBOOK_SEDIMENT_MIN_SUPPORT: '1',
      PLAYBOOK_SEDIMENT_INTERVAL_MS: '5',
    });
    expect(config.canaryPassThreshold).toBe(3);
    expect(config.sedimentMinSupport).toBe(2);
    expect(config.sedimentIntervalMs).toBe(6 * 60 * 60 * 1000);
  });
});
