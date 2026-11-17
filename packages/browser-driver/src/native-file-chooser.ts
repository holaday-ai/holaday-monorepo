import type { FileChooser, Page } from 'playwright-crx';

type ClickOutcome = 'not_applied' | 'applied' | 'unknown';
export class NativeChooserCaptureError extends Error {
  constructor(
    code: string,
    readonly clickOutcome: ClickOutcome,
  ) {
    super(code);
  }
}
export type NativeChooserCaptureResult =
  | { status: 'captured'; clickOutcome: 'applied'; chooser: FileChooser }
  | {
      status: 'not_applied';
      clickOutcome: 'not_applied';
      reason: 'scope_unavailable' | 'capture_expired';
    }
  | {
      status: 'clicked';
      clickOutcome: 'applied';
      reason: 'not_captured' | 'scope_unavailable' | 'capture_expired' | 'chooser_ambiguous';
    };

/** One trusted, already target-verified click. This grants neither a file nor
 * authority over its native input: the caller must bind the returned handle to
 * its real frame/document/session and use the existing file disclosure gate.
 * A lease releases interception even while the real click is still draining;
 * it never treats a timeout as proof the click was cancelled. */
export async function captureNativeFileChooser(
  page: Page,
  options: {
    click: () => Promise<void>;
    current: () => boolean;
    intercept: (enabled: boolean) => Promise<void>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<NativeChooserCaptureResult> {
  const timeout = options.timeoutMs ?? 2000;
  if (!Number.isInteger(timeout) || timeout < 50 || timeout > 5000)
    throw new NativeChooserCaptureError('invalid_chooser_timeout', 'not_applied');
  const current = () => {
    try {
      return !options.signal?.aborted && options.current() && !options.signal?.aborted;
    } catch {
      return false;
    }
  };
  if (!current())
    return { status: 'not_applied', clickOutcome: 'not_applied', reason: 'scope_unavailable' };
  // The pinned SDK inherits this EventEmitter method at runtime, but its public
  // Page declaration omits it. Do not cast that declaration into a guarantee:
  // refuse capture if listener ownership cannot actually be inspected.
  const listenerCount = () => {
    try {
      const inspect: unknown = Reflect.get(page, 'listenerCount');
      if (typeof inspect !== 'function') throw new Error();
      const count: unknown = Reflect.apply(inspect, page, ['filechooser']);
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error();
      return count;
    } catch {
      throw new NativeChooserCaptureError('chooser_listener_state_unavailable', 'not_applied');
    }
  };
  if (listenerCount()) throw new NativeChooserCaptureError('chooser_capture_busy', 'not_applied');
  const captured: FileChooser[] = [];
  let wake!: () => void;
  const event = new Promise<void>((resolve) => {
    wake = resolve;
  });
  let started = false;
  let clicked = false;
  let expired = false;
  let released = false;
  let enable: Promise<void> = Promise.resolve();
  let restoration: Promise<void> | undefined;
  let restoreFailed = false;
  let operationError: NativeChooserCaptureError | undefined;
  const dispose = async (chooser: FileChooser) => {
    try {
      await chooser.element().dispose();
    } catch {
      /* no file selection */
    }
  };
  const listener = (chooser: FileChooser) => {
    if (released || !started || !current() || chooser.page() !== page) {
      void dispose(chooser);
      return;
    }
    // Two native events already make the attempt ambiguous. Keep no further
    // handles, even if one site's click handler opens many inputs.
    if (captured.length < 2) captured.push(chooser);
    else void dispose(chooser);
    wake();
  };
  const release = (): Promise<void> => {
    if (!released) {
      released = true;
      try {
        page.off('filechooser', listener);
      } catch {
        restoreFailed = true;
      }
      wake();
    }
    restoration ??= (async () => {
      // An uncertain acquisition may settle later. Do not leave a late enable
      // behind, and do not call this an idle browser before restoration settles.
      await enable.catch(() => {});
      try {
        if (listenerCount()) {
          restoreFailed = true;
          return;
        }
        await options.intercept(false);
      } catch {
        restoreFailed = true;
      }
    })();
    return restoration;
  };
  const abort = () => {
    void release();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    page.on('filechooser', listener);
    enable = Promise.resolve().then(() => options.intercept(true));
    timer = setTimeout(() => {
      expired = true;
      void release();
    }, timeout);
    options.signal?.addEventListener('abort', abort, { once: true });
    await enable;
    if (current() && !expired && !released) {
      started = true;
      await options.click();
      clicked = true;
      if (!captured.length && !released && current()) await event;
    }
  } catch {
    operationError = new NativeChooserCaptureError(
      started ? 'input_outcome_unknown' : 'chooser_interception_unavailable',
      started ? 'unknown' : 'not_applied',
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    await release();
  }
  const clickOutcome: ClickOutcome = clicked ? 'applied' : started ? 'unknown' : 'not_applied';
  if (restoreFailed || operationError) {
    await Promise.all(captured.map(dispose));
    throw restoreFailed
      ? new NativeChooserCaptureError('chooser_restore_unconfirmed', clickOutcome)
      : operationError;
  }
  if (!clicked) {
    await Promise.all(captured.map(dispose));
    return {
      status: 'not_applied',
      clickOutcome: 'not_applied',
      reason: expired ? 'capture_expired' : 'scope_unavailable',
    };
  }
  if (!current() || captured.length !== 1 || expired) {
    await Promise.all(captured.map(dispose));
    return {
      status: 'clicked',
      clickOutcome: 'applied',
      reason: !current()
        ? 'scope_unavailable'
        : captured.length > 1
          ? 'chooser_ambiguous'
          : captured.length
            ? 'capture_expired'
            : 'not_captured',
    };
  }
  return { status: 'captured', clickOutcome: 'applied', chooser: captured[0]! };
}
