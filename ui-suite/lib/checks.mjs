export function assertLocalUrl(value) {
  const u = new URL(value);
  if (
    u.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password
  )
    throw Error('LOCAL_ONLY');
  return u;
}
export function evaluateGate({
  findings = [],
  coverageGaps = [],
  expectedPages,
  pages = [],
  finishedAt,
}) {
  const incomplete = expectedPages !== undefined && (pages.length !== expectedPages || !finishedAt);
  return incomplete || coverageGaps.length || findings.some((f) => f.severity === 'P1')
    ? 'failed'
    : 'passed';
}
export function classifyGeometry(elements, width, _height) {
  const findings = [];
  for (const e of elements) {
    if (e.width < 1 || e.height < 1 || e.visuallyHidden || e.intentionalOverlay) continue;
    if (!e.horizontalScroll && (e.x < -2 || e.x + e.width > width + 2))
      findings.push({
        rule: 'viewport-clipping',
        severity: 'P1',
        control: e.id,
        box: { x: e.x, y: e.y, width: e.width, height: e.height },
      });
    if (e.truncated && !e.hasHint)
      findings.push({
        rule: 'unexplained-truncation',
        severity: 'P2',
        control: e.id,
        box: { x: e.x, y: e.y, width: e.width, height: e.height },
      });
    if (e.hitBlocked && !e.intentionalOverlay)
      findings.push({
        rule: 'control-occluded',
        severity: 'P1',
        control: e.id,
        box: { x: e.x, y: e.y, width: e.width, height: e.height },
      });
  }
  for (let i = 0; i < elements.length; i++)
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      if (
        (a.adornment && b.tag === 'input') ||
        (b.adornment && a.tag === 'input') ||
        a.intentionalOverlapWith?.includes(b.id) ||
        b.intentionalOverlapWith?.includes(a.id) ||
        a.paddingFor?.includes(b.id) ||
        b.paddingFor?.includes(a.id) ||
        a.visuallyHidden ||
        b.visuallyHidden ||
        a.intentionalOverlay ||
        b.intentionalOverlay ||
        a.inViewport === false ||
        b.inViewport === false ||
        a.layer !== b.layer ||
        a.ancestorIds?.includes(b.id) ||
        b.ancestorIds?.includes(a.id)
      )
        continue;
      const area =
        Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (area > Math.min(a.width * a.height, b.width * b.height) * 0.25)
        findings.push({ rule: 'control-overlap', severity: 'P1', control: `${a.id} / ${b.id}` });
    }
  return findings;
}
export async function measurePage(page) {
  return page.evaluate(() => {
    const hiddenInClosedDetails = (e) => {
      for (let a = e.parentElement; a; a = a.parentElement) {
        if (a.tagName === 'DETAILS' && !a.open && !a.querySelector(':scope > summary')?.contains(e))
          return true;
      }
      return false;
    };
    const selectors =
      'button,a,input,textarea,select,summary,[role="button"],[role="tab"],[role="combobox"],[role="menuitem"],[role="switch"],[role="checkbox"],[role="radio"],.fc-daygrid-day[data-date]';
    const seen = new Set(
      [...document.querySelectorAll('[data-ui-audit-id]')].map((e) =>
        e.getAttribute('data-ui-audit-id'),
      ),
    );
    const elements = [...document.querySelectorAll(selectors)]
      .filter((e) => {
        if (hiddenInClosedDetails(e)) return false;
        const r = e.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(e).visibility !== 'hidden' &&
          !(
            e.tagName === 'A' &&
            !e.hasAttribute('href') &&
            !e.hasAttribute('role') &&
            !e.hasAttribute('tabindex')
          )
        );
      })
      .map((e, _i) => {
        const r = e.getBoundingClientRect();
        const style = getComputedStyle(e);
        const label = (
          e.getAttribute('aria-label') ||
          e.getAttribute('title') ||
          e.innerText ||
          e.getAttribute('placeholder') ||
          e.getAttribute('name') ||
          e.tagName
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 120);
        // Dates are data values of a bounded calendar widget, not new component types.
        const calendar = e.closest('.fc');
        const calendarDay = Boolean(calendar && e.matches('.fc-daygrid-day[data-date]'));
        const semanticLabel = calendarDay
          ? `calendar-day-slot-${[...calendar.querySelectorAll('.fc-daygrid-day[data-date]')].indexOf(e)}`
          : label;
        const key = [
          e.tagName,
          e.getAttribute('role') || '',
          semanticLabel,
          e.getAttribute('href') || '',
        ].join('|');
        let n = 0;
        while (seen.has(`${key}|${n}`)) n++;
        const id = e.getAttribute('data-ui-audit-id') ?? `${key}|${n}`;
        seen.add(id);
        e.setAttribute('data-ui-audit-id', id);
        const cx = Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2));
        const cy = Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2));
        const hit = document.elementFromPoint(cx, cy);
        let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        for (let p = e.parentElement; p; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (/hidden|clip|auto|scroll/.test(ps.overflow + ps.overflowX + ps.overflowY)) {
            const pr = p.getBoundingClientRect();
            clip = {
              left: Math.max(clip.left, pr.left),
              top: Math.max(clip.top, pr.top),
              right: Math.min(clip.right, pr.right),
              bottom: Math.min(clip.bottom, pr.bottom),
            };
          }
        }
        const visibleVertically =
          r.y + r.height / 2 >= clip.top &&
          r.y + r.height / 2 <= clip.bottom &&
          r.x + r.width / 2 >= clip.left &&
          r.x + r.width / 2 <= clip.right;
        const covered =
          style.pointerEvents !== 'none' &&
          visibleVertically &&
          hit &&
          !e.contains(hit) &&
          !hit.contains(e) &&
          ![...(e.labels ?? [])].some((l) => l.contains(hit));
        const overlay =
          document.fullscreenElement ??
          [
            ...document.querySelectorAll(
              'dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-state="open"][data-radix-popper-content-wrapper]',
            ),
          ]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return (
                r.width > 0 &&
                r.height > 0 &&
                getComputedStyle(e).visibility !== 'hidden' &&
                e.getAttribute('data-state') !== 'closed' &&
                !(
                  e.tagName === 'A' &&
                  !e.hasAttribute('href') &&
                  !e.hasAttribute('role') &&
                  !e.hasAttribute('tabindex')
                )
              );
            })
            .at(-1);
        return {
          id,
          label,
          repeatFamilyKey: (() => {
            const m = label.match(/^复用任务 (\d+) 的步骤和输出$/);
            return m && e.closest('[aria-label="新建批量任务"]')
              ? `batch-copy-${Math.min(2, Number(m[1]))}`
              : undefined;
          })(),
          exclusivePressed: (() => {
            if (
              e.getAttribute('aria-pressed') !== 'true' ||
              /星期|周[一二三四五六日天]|取消选择|收藏/.test(label) ||
              ['switch', 'checkbox'].includes(e.getAttribute('role'))
            )
              return false;
            const siblings = [...e.parentElement.querySelectorAll(':scope > button[aria-pressed]')];
            return (
              siblings.length > 1 &&
              siblings.filter((x) => x.getAttribute('aria-pressed') === 'true').length === 1
            );
          })(),
          selectedWithoutSemantics: (() => {
            if (calendarDay && e.classList.contains('hd-selected-day')) return true;
            if (
              e.tagName !== 'BUTTON' ||
              e.hasAttribute('aria-selected') ||
              e.hasAttribute('aria-pressed')
            )
              return false;
            const has = (token) => e.classList.contains(token);
            const p = location.pathname;
            return (
              (/^(密码登录|验证码登录|手机登录)$/.test(label) && has('border-[#DCDDDD]')) ||
              (p === '/admin/finance' &&
                /^(营收明细|成本明细)$/.test(label) &&
                has('border-[#FF0061]')) ||
              (p === '/admin/learning' &&
                /^(全部|仅高风险)$/.test(label) &&
                has('border-[#FF0061]')) ||
              (/^(企业微信|飞书|钉钉)/.test(label) && has('border-[#FF0061]/70')) ||
              (p === '/plan' &&
                /^(按月|按年)/.test(label) &&
                has('bg-white') &&
                has('text-[#FF0061]')) ||
              (p === '/video' &&
                /^选择(氛围|光感|色彩)$/.test(
                  e.closest('[role=dialog]')?.getAttribute('aria-label') ?? '',
                ) &&
                /^(氛围|光感|色彩)/.test(label) &&
                has('border-b-2') &&
                has('text-white') &&
                Boolean(e.style.borderColor)) ||
              (p === '/history' &&
                /^(全部|已完成|需复核|失败|进行中|近 7 天|近 30 天)$/.test(label) &&
                has('bg-white') &&
                has('text-[#FF0061]')) ||
              (['/schedule', '/planned/legacy-scheduled'].includes(p) &&
                /^(不重复|每天|每周|每月|自定义|不提醒|执行时|5分钟前|15分钟前|30分钟前|1小时前)$/.test(
                  label,
                ) &&
                has('border-[#FF0061]/30'))
            );
          })(),
          adornment: e.tagName === 'BUTTON' && /^(显示密码|隐藏密码)$/.test(label),
          scope: (() => {
            const layer = e.closest(
              'dialog[open],[role=dialog],[role=alertdialog],[role=menu],[role=tabpanel]',
            );
            return (
              layer?.getAttribute('aria-label') ||
              layer?.querySelector('h1,h2,h3')?.textContent?.trim() ||
              layer?.getAttribute('role') ||
              'page'
            );
          })(),
          visuallyHidden: style.opacity === '0' || (r.width <= 2 && r.height <= 2),
          horizontalScroll: (() => {
            for (let p = e.parentElement; p; p = p.parentElement) {
              if (
                ['auto', 'scroll'].includes(getComputedStyle(p).overflowX) &&
                p.scrollWidth > p.clientWidth + 2
              )
                return true;
            }
            return false;
          })(),
          shared: Boolean(
            e.closest('aside,[data-sidebar="sidebar"],[data-testid="desktop-account-dock"]'),
          ),
          tag: e.tagName.toLowerCase(),
          role: e.getAttribute('role'),
          type: e.getAttribute('type'),
          href: e.getAttribute('href'),
          disabled: e.disabled || e.getAttribute('aria-disabled') === 'true',
          hasHint: Boolean(e.getAttribute('title') || e.getAttribute('aria-describedby')),
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          scrollWidth: e.scrollWidth,
          clientWidth: e.clientWidth,
          truncated: style.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 2,
          hitBlocked: Boolean(covered),
          intentionalOverlay: Boolean(overlay && !overlay.contains(e)),
          inViewport: visibleVertically,
          layer: (() => {
            const dialogs = [
              ...document.querySelectorAll(
                'dialog[open],[role=dialog],[role=alertdialog],[role=menu]',
              ),
            ];
            const layer = e.closest('dialog[open],[role=dialog],[role=alertdialog],[role=menu]');
            if (layer) return layer.id || `overlay-${dialogs.indexOf(layer)}`;
            const live = e.closest('[aria-live=polite]');
            if (live && getComputedStyle(live).position === 'fixed') return 'fixed-toast';
            return 'page';
          })(),
          intentionalOverlapWith: (() => {
            const row = e.closest('.hd-file-collection[data-view="grid"] .hd-file-row');
            const actions = row?.lastElementChild;
            const preview = row?.querySelector(':scope > button');
            return actions &&
              preview &&
              actions.contains(e) &&
              getComputedStyle(actions).position === 'absolute'
              ? [preview.getAttribute('data-ui-audit-id')].filter(Boolean)
              : [];
          })(),
          paddingFor:
            e.tagName === 'BUTTON'
              ? [...document.querySelectorAll('textarea,input')]
                  .filter((input) => {
                    const box = input.getBoundingClientRect();
                    const s = getComputedStyle(input);
                    const inside =
                      r.left >= box.left &&
                      r.right <= box.right &&
                      r.top >= box.top &&
                      r.bottom <= box.bottom;
                    return (
                      inside &&
                      ((Number.parseFloat(s.paddingBottom) > 0 &&
                        r.top >= box.bottom - Number.parseFloat(s.paddingBottom)) ||
                        (Number.parseFloat(s.paddingRight) > 0 &&
                          r.left >= box.right - Number.parseFloat(s.paddingRight)))
                    );
                  })
                  .map((input) => input.getAttribute('data-ui-audit-id'))
                  .filter(Boolean)
              : [],
          ancestorIds: [...document.querySelectorAll('[data-ui-audit-id]')]
            .filter((p) => p !== e && p.contains(e))
            .map((p) => p.getAttribute('data-ui-audit-id')),
          value: e.value,
          expanded: e.getAttribute('aria-expanded'),
          checked: e.checked,
        };
      });
    const truncatedText = [...document.querySelectorAll('p,span,h1,h2,h3,td,div')]
      .filter(
        (e) =>
          !hiddenInClosedDetails(e) &&
          e.childElementCount === 0 &&
          e.textContent.trim() &&
          getComputedStyle(e).overflow !== 'visible' &&
          (e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2) &&
          !e.closest('button,a,input,textarea,select'),
      )
      .map((e) => ({
        text: e.textContent.trim().slice(0, 100),
        hasHint: Boolean(e.title || e.getAttribute('aria-describedby') || e.closest('[title]')),
      }));
    return {
      browserPanelVisible: [
        ...document.querySelectorAll('section[aria-label="浏览器工作区"]'),
      ].some((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(e).visibility !== 'hidden' &&
          !(
            e.tagName === 'A' &&
            !e.hasAttribute('href') &&
            !e.hasAttribute('role') &&
            !e.hasAttribute('tabindex')
          )
        );
      }),
      elements,
      truncatedText,
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      text: document.body.innerText,
      url: location.href,
    };
  });
}

export function taskStateFindings(text, { status, mode, browserPanelVisible = false }) {
  const result = [];
  if (mode !== 'browser' && browserPanelVisible)
    result.push({ rule: 'wrong-task-browser-panel', severity: 'P1' });
  if (['completed', 'failed', 'cancelled'].includes(status) && /正在处理|正在生成回答/.test(text))
    result.push({ rule: 'terminal-progress-stale', severity: 'P1' });
  if (mode !== 'browser' && /输入网址开始|连接 Chrome|浏览器遇到问题|换个网址/.test(text))
    result.push({ rule: 'wrong-task-browser-ui', severity: 'P1' });
  return result;
}
export function pixelDifference(a, b, { threshold = 30, maxRatio = 0.01 } = {}) {
  if (a.width !== b.width || a.height !== b.height)
    return { different: true, ratio: 1, reason: 'dimensions changed' };
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (Math.max(...[0, 1, 2].map((k) => Math.abs(a.data[i + k] - b.data[i + k]))) > threshold)
      changed++;
  const ratio = changed / (a.width * a.height);
  return { different: ratio > maxRatio, ratio };
}
