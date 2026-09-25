import { describe, expect, it, vi } from 'vitest';
import {
  BrowserExecutionBusyError,
  createBrowserExecutionOwnership,
} from './browser-execution-ownership.js';

describe('browser execution ownership', () => {
  it('rejects legacy execution while a selected session owns the browser', async () => {
    const ownership = createBrowserExecutionOwnership();
    const selected = ownership.acquireSelected();
    expect(selected).not.toBeNull();

    const legacy = vi.fn(async () => 'legacy');
    await expect(ownership.runLegacy(legacy)).rejects.toBeInstanceOf(BrowserExecutionBusyError);
    expect(legacy).not.toHaveBeenCalled();

    selected?.release();
    await expect(ownership.runLegacy(legacy)).resolves.toBe('legacy');
  });

  it('keeps legacy ownership until the native promise settles after an outer timeout', async () => {
    const ownership = createBrowserExecutionOwnership();
    let finish!: () => void;
    const native = ownership.runLegacy(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    await Promise.race([native, Promise.resolve('outer-timeout')]);
    expect(ownership.acquireSelected()).toBeNull();

    finish();
    await native;
    const selected = ownership.acquireSelected();
    expect(selected).not.toBeNull();
    selected?.release();
  });

  it('counts concurrent legacy operations until each native promise settles', async () => {
    const ownership = createBrowserExecutionOwnership();
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = ownership.runLegacy(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const second = ownership.runLegacy(
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
    );

    finishFirst();
    await first;
    expect(ownership.acquireSelected()).toBeNull();
    finishSecond();
    await second;

    const selected = ownership.acquireSelected();
    expect(selected).not.toBeNull();
    selected?.release();
  });
});
