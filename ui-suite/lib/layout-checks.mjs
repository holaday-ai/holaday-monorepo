/** Measure the shell as well as clipped layout regions; document.scrollWidth
 * alone misses a flex row whose overflowing children are hidden by an ancestor. */
export async function measureLayout(page) {
  return page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    };
    const fullHeight = [
      ...document.querySelectorAll('.holaday-shell,.holaday-main,.holaday-sidebar'),
    ]
      .filter(visible)
      .map((element) => ({
        name: element.classList.contains('holaday-main')
          ? 'main'
          : element.classList.contains('holaday-sidebar')
            ? 'sidebar'
            : 'shell',
        ...box(element),
      }));
    const bounded = [
      ...document.querySelectorAll(
        '.holaday-main,.hd-new-task-stage,.hd-new-task-home,[data-testid="workbench-main-panel"],[data-layout-container],section[aria-label="浏览器工作区"]',
      ),
    ]
      .filter(visible)
      .map((element) => ({
        name:
          element.getAttribute('data-layout-container') ||
          element.getAttribute('aria-label') ||
          element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        ...box(element),
      }));
    const header = document.querySelector('.hd-shell-topbar');
    const browser = document.querySelector('section[aria-label="浏览器工作区"]');
    const headerCoversBrowser =
      header &&
      browser &&
      visible(header) &&
      visible(browser) &&
      Number(getComputedStyle(header).opacity) > 0 &&
      !['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(header).backgroundColor) &&
      (() => {
        const h = header.getBoundingClientRect(),
          b = browser.getBoundingClientRect();
        return (
          Math.min(h.right, b.right) - Math.max(h.left, b.left) > 2 &&
          Math.min(h.bottom, b.top + 48) - Math.max(h.top, b.top) > 2
        );
      })();
    return {
      headerCoversBrowser: Boolean(headerCoversBrowser),
      width: innerWidth,
      height: innerHeight,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      fullHeight,
      bounded,
    };
  });
}

export function layoutFindings(layout) {
  const findings = [];
  if (layout.headerCoversBrowser)
    findings.push({
      rule: 'browser-header-occluded',
      severity: 'P1',
      control: 'browser toolbar',
      detail: 'opaque shell header paints over the browser toolbar',
    });
  if (layout.documentWidth > layout.width + 2)
    findings.push({
      rule: 'horizontal-overflow',
      severity: 'P1',
      control: 'document',
      detail: `${layout.documentWidth}>${layout.width}`,
    });
  for (const box of layout.bounded) {
    if (box.scrollWidth > box.clientWidth + 2 || box.x < -2 || box.x + box.width > layout.width + 2)
      findings.push({
        rule: 'horizontal-overflow',
        severity: 'P1',
        control: box.name,
        detail: `scroll=${box.scrollWidth}/${box.clientWidth}; x=${box.x}, width=${box.width}`,
        box,
      });
  }
  for (const box of layout.fullHeight) {
    if (box.y > 2 || box.y + box.height < layout.height - 2)
      findings.push({
        rule: 'main-container-height',
        severity: 'P1',
        control: box.name,
        detail: `top=${box.y}, bottom=${box.y + box.height}; viewport=${layout.height}`,
        box,
      });
  }
  return findings;
}
