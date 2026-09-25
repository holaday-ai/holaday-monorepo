import { expect, it, vi } from 'vitest';
import { createMaintenanceBackground } from './ordinary-maintenance-background.js';

it('starts each registered producer once and never starts after a close barrier', async () => {
  const group = createMaintenanceBackground();
  const start = vi.fn();
  const stop = vi.fn(async () => {});
  group.register('scheduled', { start, stop });
  group.startOnce();
  group.startOnce();
  expect(start).toHaveBeenCalledOnce();
  await group.stopAll();
  expect(() => group.startOnce()).toThrow('MAINTENANCE_BACKGROUND_STOPPED');
  expect(stop).toHaveBeenCalledOnce();
});
it('waits for all original stop promises, including when another producer failed', async () => {
  const group = createMaintenanceBackground();
  let done!: () => void;
  const held = new Promise<void>((resolve) => {
    done = resolve;
  });
  const stop = vi.fn(() => held);
  group.register('slow', { start() {}, stop });
  group.register('failed', {
    start() {},
    async stop() {
      throw new Error('synthetic');
    },
  });
  group.startOnce();
  let settled = false;
  const original = group.stopAll();
  const observed = original.catch(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(group.stopAll()).toBe(original);
  done();
  await expect(original).rejects.toThrow('MAINTENANCE_BACKGROUND_UNPROVEN');
  await observed;
  await expect(group.stopAll()).rejects.toThrow('MAINTENANCE_BACKGROUND_UNPROVEN');
  expect(stop).toHaveBeenCalledOnce();
});
it('does not stop a producer that was never started', async () => {
  const group = createMaintenanceBackground();
  const stop = vi.fn(async () => {});
  group.register('scheduled', { start: vi.fn(), stop });
  await group.stopAll();
  expect(stop).not.toHaveBeenCalled();
  expect(() => group.startOnce()).toThrow();
});
it('retains partially started producers for cleanup and rejects late registration', async () => {
  const group = createMaintenanceBackground();
  const stop = vi.fn(async () => {});
  group.register('first', {
    start() {
      throw new Error('synthetic start');
    },
    stop,
  });
  expect(() => group.startOnce()).toThrow('synthetic start');
  expect(() => group.register('late', { start() {}, async stop() {} })).toThrow();
  await group.stopAll();
  expect(stop).toHaveBeenCalledOnce();
});
