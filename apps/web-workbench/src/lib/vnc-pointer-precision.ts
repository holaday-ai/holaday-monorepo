/** Keep fractional pointer positions when noVNC converts its displayed canvas
 * to framebuffer coordinates. noVNC still owns scaling, viewport and RFB ACKs.
 * Native legacy MouseEvent positions are integers on Chromium. */
export function installVncPointerPrecisionBridge(canvas: HTMLCanvasElement): () => void {
  const pairs = [
    ['pointerdown', 'mousedown'],
    ['pointerup', 'mouseup'],
    ['pointermove', 'mousemove'],
  ] as const;
  const handlers = pairs.map(([pointer, mouse]) => {
    const forward = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return; // noVNC owns its touch gesture recognizer
      canvas.dispatchEvent(
        new PointerEvent(mouse, {
          clientX: event.clientX,
          clientY: event.clientY,
          button: event.button,
          buttons: event.buttons,
          pointerType: event.pointerType,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    const suppress = (event: MouseEvent) => {
      if (event instanceof PointerEvent) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    canvas.addEventListener(pointer, forward, true);
    canvas.addEventListener(mouse, suppress, true);
    return () => {
      canvas.removeEventListener(pointer, forward, true);
      canvas.removeEventListener(mouse, suppress, true);
    };
  });
  return () => {
    for (const dispose of handlers) dispose();
  };
}
