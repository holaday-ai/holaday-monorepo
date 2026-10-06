import { useEffect, useRef } from 'react';

/** Approved new-task grid: pointer trail only; never intercepts input. */
export function AmbientGrid() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    const canvas = layer?.querySelector('canvas');
    const host = layer?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!layer || !canvas || !host || !ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const cells = new Map<
      string,
      { x: number; y: number; born: number; power: number; hue: number }
    >();
    let frame = 0;
    let width = 0,
      height = 0;
    let last: { x: number; y: number } | null = null;
    const clear = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      cells.clear();
      last = null;
      ctx.clearRect(0, 0, width, height);
    };
    const resize = () => {
      clear();
      const box = layer.getBoundingClientRect();
      width = box.width;
      height = box.height;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = (now: number) => {
      frame = 0;
      ctx.clearRect(0, 0, width, height);
      for (const [key, cell] of cells) {
        const age = now - cell.born;
        if (age >= 2300) {
          cells.delete(key);
          continue;
        }
        const opacity = cell.power * (1 - age / 2300) ** 2 * Math.min(1, age / 110);
        ctx.fillStyle = `hsla(${cell.hue},92%,56%,${opacity})`;
        ctx.fillRect(cell.x * 28 + 1, cell.y * 28 + 1, 27, 27);
      }
      if (cells.size) frame = requestAnimationFrame(draw);
    };
    const stamp = (x: number, y: number, now: number) => {
      const cx = Math.floor(x / 28),
        cy = Math.floor(y / 28);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          if (cx + dx < 0 || cy + dy < 0 || (cx + dx) * 28 > width || (cy + dy) * 28 > height)
            continue;
          const seed = (((cx + dx) * 17 + (cy + dy) * 31) % 11) / 11;
          if ((dx || dy) && seed > 0.55) continue;
          const key = `${cx + dx}:${cy + dy}`;
          cells.set(key, {
            x: cx + dx,
            y: cy + dy,
            born: now,
            power: dx || dy ? 0.24 + seed * 0.4 : 0.82,
            hue: 170 + (((cx + dx) * 9 + (cy + dy) * 12 + now / 95) % 160),
          });
        }
      while (cells.size > 150) cells.delete(cells.keys().next().value!);
    };
    const move = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType === 'touch' || document.hidden) return;
      if (
        (event.target as Element).closest('button,input,textarea,[role="dialog"],.hd-task-composer')
      ) {
        last = null;
        return;
      }
      const box = layer.getBoundingClientRect();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) {
        last = null;
        return;
      }
      const now = performance.now();
      const origin = last ?? point;
      const steps = Math.min(
        14,
        Math.max(1, Math.ceil(Math.hypot(point.x - origin.x, point.y - origin.y) / 14)),
      );
      for (let i = 1; i <= steps; i++)
        stamp(
          origin.x + ((point.x - origin.x) * i) / steps,
          origin.y + ((point.y - origin.y) * i) / steps,
          now,
        );
      last = point;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const leave = () => {
      last = null;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(layer);
    resize();
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', clear);
    reduced.addEventListener('change', clear);
    return () => {
      clear();
      observer.disconnect();
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', clear);
      reduced.removeEventListener('change', clear);
    };
  }, []);
  return (
    <div ref={ref} className="hd-ambient-grid" aria-hidden="true">
      <canvas />
    </div>
  );
}
