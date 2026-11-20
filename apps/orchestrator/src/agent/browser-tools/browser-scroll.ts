import type { Frame } from 'playwright';

/** Scroll the visible scroll surface, which may be an inner feed rather than
 * window. Count content only, and allow asynchronous loaders time to finish. */
export async function scrollWithEvidence(
  frame: Frame,
  direction: 'up' | 'down' = 'down',
  amount = 1,
  timeout = 3500,
  reveal?: () => Promise<void>,
) {
  const target = await frame.evaluateHandle(() => {
    let selected = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    let score = selected.scrollHeight > selected.clientHeight + 2 ? innerWidth * innerHeight : 0;
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (
        node.scrollHeight <= node.clientHeight + 2 ||
        !/auto|scroll/.test(getComputedStyle(node).overflowY)
      )
        continue;
      const box = node.getBoundingClientRect();
      const area =
        Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0)) *
        Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
      if (area > score && box.width > 40 && box.height > 40) {
        selected = node;
        score = area;
      }
    }
    return selected;
  });
  const measure = () =>
    target.evaluate((node) => {
      const scope = node === document.documentElement ? document.body : node;
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let chars = 0;
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (
          !parent?.getClientRects().length ||
          parent.closest(
            'script,style,[role=progressbar],[aria-busy=true],.jscroll-loading,.loading,.loader,.spinner',
          )
        )
          continue;
        chars += (walker.currentNode.textContent ?? '').trim().length;
      }
      const media = Array.from(scope.querySelectorAll('img')).filter(
        (img) => img.complete && img.naturalWidth > 0,
      ).length;
      return {
        height: node.scrollHeight,
        chars,
        media,
        top: node.scrollTop,
        viewport: node.clientHeight,
      };
    });
  try {
    const before = await measure();
    if (reveal) await reveal();
    else
      await target.evaluate(
        (node, value) => node.scrollBy(0, (value.direction === 'up' ? -1 : 1) * 600 * value.amount),
        { direction, amount },
      );
    const deadline = Date.now() + Math.min(timeout, 5000);
    let after = await measure();
    let stableSince = Date.now();
    while (direction !== 'up' && Date.now() < deadline) {
      const next = await measure();
      if (next.chars !== after.chars || next.media !== after.media) stableSince = Date.now();
      after = next;
      if (
        (after.chars > before.chars || after.media > before.media) &&
        Date.now() - stableSince >= 250
      )
        break;
      if (
        after.top !== before.top &&
        after.top + after.viewport < after.height - 24 &&
        Date.now() - stableSince >= 250
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return {
      beforeHeight: before.height,
      afterHeight: after.height,
      addedChars: Math.max(0, after.chars - before.chars),
      grew: after.chars > before.chars || after.media > before.media,
      beforeTop: before.top,
      afterTop: after.top,
    };
  } finally {
    await target.dispose();
  }
}
