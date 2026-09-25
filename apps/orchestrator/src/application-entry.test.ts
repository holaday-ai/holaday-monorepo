import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({
  boot: vi.fn(),
  main: vi.fn(),
  loads: 0,
  mode: vi.fn(() => false),
  ordinary: vi.fn(),
  readiness: vi.fn(),
}));
vi.mock('./execution/ordinary-maintenance-readiness.js', () => ({
  verifyProductionMaintenanceReadiness: seam.readiness,
}));
vi.mock('./execution/ordinary-maintenance-mode.js', () => ({
  ORDINARY_MAINTENANCE_DIRECTORY: '/var/lib/holaday/ordinary-maintenance',
  resolveOrdinaryMaintenanceMode: seam.mode,
}));
vi.mock('./execution/ordinary-application.js', () => ({
  createOrdinaryApplication: seam.ordinary,
}));
vi.mock('./execution/application-boot.js', () => ({ startApplicationBoot: seam.boot }));
vi.mock('./application-main.js', () => {
  seam.loads++;
  return { startApplication: seam.main };
});
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('HOLADAY_POOL_CANDIDATE', undefined);
  vi.stubEnv('HOLADAY_POOL_BOOT', undefined);
  seam.loads = 0;
  seam.boot.mockReset();
  seam.main.mockReset();
  seam.mode.mockReset().mockReturnValue(false);
  seam.ordinary.mockReset();
  seam.readiness.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function load() {
  const name = './application-entry.js';
  const module = await import(name).catch(() => undefined);
  expect(module, 'application entry must isolate imports behind boot').toBeDefined();
  if (!module) throw new Error('missing entry');
  return module as typeof import('./application-entry.js');
}
it('legacy entry keeps its existing application path without constructing a controlled boot', async () => {
  const { launchApplication } = await load();
  await launchApplication();
  expect(seam.boot).not.toHaveBeenCalled();
  expect(seam.main).toHaveBeenCalledWith(undefined);
});
it('validates the maintenance marker before importing the main application', async () => {
  seam.mode.mockImplementation(() => {
    throw new Error('MAINTENANCE_CONFIGURATION_REQUIRED');
  });
  const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
  const { launchApplication } = await load();
  await expect(launchApplication()).rejects.toThrow();
  expect(seam.loads).toBe(0);
  expect(seam.main).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});
it('passes ordinary lifecycle separately from native boot and starts control after application binding', async () => {
  seam.mode.mockReturnValue(true);
  const order: string[] = [];
  const ordinary = {
    startControl: vi.fn(async () => {
      order.push('control');
    }),
  };
  seam.ordinary.mockReturnValue(ordinary);
  seam.main.mockImplementation(async () => {
    order.push('main');
  });
  const { launchApplication } = await load();
  await launchApplication();
  expect(seam.boot).not.toHaveBeenCalled();
  expect(seam.main).toHaveBeenCalledWith(undefined, ordinary);
  expect(order).toEqual(['main', 'control']);
});
it('binds actual read-only readiness to the original process identity and propagates denial', async () => {
  vi.stubEnv('HOLADAY_ORDINARY_CANDIDATE', 'a'.repeat(40));
  seam.mode.mockReturnValue(true);
  seam.ordinary.mockReturnValue({ startControl: vi.fn(async () => {}) });
  const { launchApplication } = await load();
  await launchApplication();
  const input = seam.ordinary.mock.calls[0]![0];
  seam.readiness.mockRejectedValue(new Error('MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN'));
  await expect(input.verifyReady(input.identity)).rejects.toThrow(
    'MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN',
  );
  expect(seam.readiness).toHaveBeenCalledWith(input.identity, input.identity);
});
it('controlled entry must finish closed boot before importing application modules', async () => {
  vi.stubEnv('HOLADAY_POOL_BOOT', 'b'.repeat(32));
  vi.stubEnv('HOLADAY_POOL_CANDIDATE', 'a'.repeat(40));
  let release!: (value: unknown) => void;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const context = { close: vi.fn(async () => {}) };
  seam.boot.mockReturnValue(ready);
  const { launchApplication } = await load();
  const pending = launchApplication();
  await Promise.resolve();
  expect(seam.loads).toBe(0);
  expect(seam.main).not.toHaveBeenCalled();
  release(context);
  await pending;
  expect(seam.boot).toHaveBeenCalledWith('/var/lib/holaday/execution-drain');
  expect(seam.main).toHaveBeenCalledWith(context);
});
it('partial controlled metadata cannot fall back to legacy or load application modules', async () => {
  vi.stubEnv('HOLADAY_POOL_BOOT', 'b'.repeat(32));
  seam.boot.mockRejectedValue(new Error('synthetic invalid capsule'));
  const { launchApplication } = await load();
  await expect(launchApplication()).rejects.toThrow();
  expect(seam.loads).toBe(0);
  expect(seam.main).not.toHaveBeenCalled();
});
it('application failure closes its original boot and never starts a fallback application', async () => {
  const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
  vi.stubEnv('HOLADAY_POOL_BOOT', 'b'.repeat(32));
  const context = { close: vi.fn(async () => {}) };
  seam.boot.mockResolvedValue(context);
  seam.main.mockRejectedValue(new Error('synthetic startup error'));
  const { launchApplication } = await load();
  await expect(launchApplication()).rejects.toThrow();
  expect(context.close).toHaveBeenCalledOnce();
  expect(seam.main).toHaveBeenCalledOnce();
  expect(exit).not.toHaveBeenCalled();
});

it.each([false, true])(
  'ordinary startup failure requests immediate exit even if late metadata appears: %s',
  async (lateMetadata) => {
    const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { launchApplication } = await load();
    seam.main.mockImplementation(async () => {
      // Imported application configuration must not change the entry's original mode.
      if (lateMetadata) vi.stubEnv('HOLADAY_POOL_BOOT', 'late-dotenv-value');
      throw new Error('synthetic startup failure after HTTP bind');
    });
    await expect(launchApplication()).rejects.toThrow('APPLICATION_START_UNPROVEN');
    expect(exit.mock.calls).toEqual([[1]]);
    expect(seam.boot).not.toHaveBeenCalled();
  },
);
