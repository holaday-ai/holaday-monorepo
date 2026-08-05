import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTaskHeartbeat } from './task-heartbeat.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('startTaskHeartbeat', () => {
  it('touches only an executing task and stops cleanly', async () => {
    vi.useFakeTimers();
    const writes: Array<{ values: Record<string, unknown>; predicate: string }> = [];
    const db = {
      update() {
        return {
          set(values: Record<string, unknown>) {
            return {
              async where(predicate: unknown) {
                writes.push({
                  values,
                  predicate: require('node:util').inspect(predicate, {
                    depth: 8,
                    getters: true,
                  }),
                });
                return { affectedRows: 1 };
              },
            };
          },
        };
      },
    };

    const heartbeat = startTaskHeartbeat(db as never, 'task_video_1', {
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.values.updatedAt).toBeInstanceOf(Date);
    expect(writes[0]?.predicate).toContain("value: 'task_video_1'");
    expect(writes[0]?.predicate).toContain("value: 'executing'");

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(writes).toHaveLength(1);
  });

  it('reports a failed heartbeat without throwing into the timer loop', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const db = {
      update() {
        return {
          set() {
            return {
              async where() {
                throw new Error('db unavailable');
              },
            };
          },
        };
      },
    };
    const heartbeat = startTaskHeartbeat(db as never, 'task_video_2', {
      intervalMs: 1_000,
      onError,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db unavailable' }));
    heartbeat.stop();
  });
});
