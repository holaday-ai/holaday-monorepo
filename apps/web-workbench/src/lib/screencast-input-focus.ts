interface FocusableInput {
  focus(options?: FocusOptions): void;
}

interface PointerEventWithDefault {
  preventDefault(): void;
}

interface RetainScreencastInputFocusOptions {
  event: PointerEventWithDefault;
  input: FocusableInput | null;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
}

export function retainScreencastInputFocus({
  event,
  input,
  scheduleFrame = requestAnimationFrame,
}: RetainScreencastInputFocusOptions): void {
  event.preventDefault();
  input?.focus({ preventScroll: true });
  scheduleFrame(() => input?.focus({ preventScroll: true }));
}
